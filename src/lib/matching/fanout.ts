import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { serviceDb } from "@/db/service";
import { opportunityAlerts } from "@/db/schema";
import { MATCHING } from "@/config/matching";
import {
  loadOpportunityContext,
  loadProviderScoringData,
  prefilterCandidates,
  type OpportunityContext,
  type ProviderScoringData,
  type ZoneCandidate,
} from "./engine";
import { combineGrade, scorePay, scoreSchedule, scoreServices, type Grade, type ScoreCard } from "./score";
import { dispatchOpportunityAlert } from "@/lib/notifications/dispatch";

/**
 * Fanout orchestration (MATCHING_LOGIC.md §4–7). Idempotent by construction:
 * the opportunity_alerts ledger is written ON CONFLICT DO NOTHING and only a
 * successful insert dispatches — worker retries and duplicate enqueues can
 * never double-alert.
 */

interface ZoneEvaluation {
  zone: ZoneCandidate;
  grade: Grade;
  card: ScoreCard;
}

function evaluateZone(
  ctx: OpportunityContext,
  zone: ZoneCandidate,
  provider: ProviderScoringData,
): ZoneEvaluation | null {
  const card: ScoreCard = {
    pay: scorePay(ctx.opp, { minPayCents: zone.minPayCents, minPayUnit: zone.minPayUnit }),
    services: scoreServices(ctx.serviceIds, provider.serviceIds),
    schedule: scoreSchedule(
      ctx.occurrences,
      ctx.opp.timezone,
      { daysOfWeek: zone.daysOfWeek, timeStartLocal: zone.timeStartLocal, timeEndLocal: zone.timeEndLocal },
      provider.availability,
    ),
  };
  const grade = combineGrade(card);
  if (!grade) return null;
  // Exact-only zones never receive close — filtered BEFORE the ledger, so a
  // later improvement to exact arrives as a fresh first alert.
  if (!zone.alertGrades.includes(grade)) return null;
  return { zone, grade, card };
}

/** Best zone wins: exact beats close; ties go to the first candidate. */
function bestEvaluation(evals: ZoneEvaluation[]): ZoneEvaluation | null {
  if (evals.length === 0) return null;
  return evals.find((e) => e.grade === "exact") ?? evals[0];
}

function scoreJson(evaluation: ZoneEvaluation, ctx: OpportunityContext) {
  return {
    pay: evaluation.card.pay,
    services: evaluation.card.services,
    schedule: evaluation.card.schedule,
    paySnapshot: {
      cents: ctx.opp.payMaxCents ?? ctx.opp.payMinCents,
      unit: ctx.opp.payUnit,
    },
  };
}

function alertNotes(evaluation: ZoneEvaluation): string[] {
  return [evaluation.card.pay.note, evaluation.card.services.note, evaluation.card.schedule.note].filter(
    (n): n is string => Boolean(n),
  );
}

function urgentSmsForced(ctx: OpportunityContext): boolean {
  return (
    ctx.opp.urgent &&
    ctx.firstOpenStart != null &&
    ctx.firstOpenStart.getTime() - Date.now() < MATCHING.urgentSmsWindowHours * 3600_000
  );
}

interface ProviderMatch {
  providerProfileId: string;
  userId: string;
  evaluation: ZoneEvaluation;
}

async function matchProviders(ctx: OpportunityContext): Promise<ProviderMatch[]> {
  const candidates = await prefilterCandidates(ctx);
  if (candidates.length === 0) return [];

  const byProvider = new Map<string, ZoneCandidate[]>();
  for (const candidate of candidates) {
    const list = byProvider.get(candidate.providerProfileId) ?? [];
    list.push(candidate);
    byProvider.set(candidate.providerProfileId, list);
  }
  const scoringData = await loadProviderScoringData([...byProvider.keys()]);

  const matches: ProviderMatch[] = [];
  for (const [providerProfileId, zones] of byProvider) {
    const provider = scoringData.get(providerProfileId) ?? { serviceIds: new Set<string>(), availability: [] };
    const evals = zones
      .map((zone) => evaluateZone(ctx, zone, provider))
      .filter((e): e is ZoneEvaluation => e !== null);
    const best = bestEvaluation(evals);
    if (best) {
      matches.push({ providerProfileId, userId: best.zone.userId, evaluation: best });
    }
  }
  return matches;
}

export interface FanoutResult {
  matched: number;
  alerted: number;
  realerted: number;
}

export async function fanoutOpportunityPosted(opportunityId: string): Promise<FanoutResult> {
  const ctx = await loadOpportunityContext(opportunityId);
  if (!ctx) {
    console.warn(`[fanout] opportunity ${opportunityId} not found or has no location pin`);
    return { matched: 0, alerted: 0, realerted: 0 };
  }
  if (ctx.opp.status !== "posted") {
    console.log(`[fanout] opportunity ${opportunityId} is ${ctx.opp.status}, skipping`);
    return { matched: 0, alerted: 0, realerted: 0 };
  }

  const matches = await matchProviders(ctx);
  const forceSms = urgentSmsForced(ctx);
  let alerted = 0;

  for (const match of matches) {
    const inserted = await serviceDb
      .insert(opportunityAlerts)
      .values({
        opportunityId,
        providerProfileId: match.providerProfileId,
        watchZoneId: match.evaluation.zone.zoneId,
        matchGrade: match.evaluation.grade,
        score: scoreJson(match.evaluation, ctx),
      })
      .onConflictDoNothing()
      .returning({ providerProfileId: opportunityAlerts.providerProfileId });
    if (inserted.length === 0) continue; // already alerted — dedup ledger

    const notificationId = await dispatchOpportunityAlert(serviceDb, {
      userId: match.userId,
      ctx,
      grade: match.evaluation.grade,
      notes: alertNotes(match.evaluation),
      zoneName: match.evaluation.zone.zoneName,
      channels: {
        inApp: match.evaluation.zone.channelInApp,
        email: match.evaluation.zone.channelEmail,
        sms: match.evaluation.zone.channelSms,
      },
      forceSms,
      realert: false,
    });
    await serviceDb
      .update(opportunityAlerts)
      .set({ notificationId })
      .where(
        and(
          eq(opportunityAlerts.opportunityId, opportunityId),
          eq(opportunityAlerts.providerProfileId, match.providerProfileId),
        ),
      );
    alerted += 1;
  }

  console.log(`[fanout] ${opportunityId}: ${matches.length} matched, ${alerted} new alerts`);
  return { matched: matches.length, alerted, realerted: 0 };
}

/**
 * Material-edit pass: never-alerted providers who now match get a normal
 * alert; already-alerted providers re-notify only when the grade improved
 * (close→exact) or pay rose ≥10% vs the alerted snapshot — at most once.
 */
export async function fanoutOpportunityUpdated(opportunityId: string): Promise<FanoutResult> {
  const ctx = await loadOpportunityContext(opportunityId);
  if (!ctx || ctx.opp.status !== "posted") {
    return { matched: 0, alerted: 0, realerted: 0 };
  }

  const matches = await matchProviders(ctx);
  const forceSms = urgentSmsForced(ctx);
  let alerted = 0;
  let realerted = 0;

  for (const match of matches) {
    const [existing] = await serviceDb
      .select()
      .from(opportunityAlerts)
      .where(
        and(
          eq(opportunityAlerts.opportunityId, opportunityId),
          eq(opportunityAlerts.providerProfileId, match.providerProfileId),
        ),
      );

    if (!existing) {
      const inserted = await serviceDb
        .insert(opportunityAlerts)
        .values({
          opportunityId,
          providerProfileId: match.providerProfileId,
          watchZoneId: match.evaluation.zone.zoneId,
          matchGrade: match.evaluation.grade,
          score: scoreJson(match.evaluation, ctx),
        })
        .onConflictDoNothing()
        .returning({ providerProfileId: opportunityAlerts.providerProfileId });
      if (inserted.length === 0) continue;
      const notificationId = await dispatchOpportunityAlert(serviceDb, {
        userId: match.userId,
        ctx,
        grade: match.evaluation.grade,
        notes: alertNotes(match.evaluation),
        zoneName: match.evaluation.zone.zoneName,
        channels: {
          inApp: match.evaluation.zone.channelInApp,
          email: match.evaluation.zone.channelEmail,
          sms: match.evaluation.zone.channelSms,
        },
        forceSms,
        realert: false,
      });
      await serviceDb
        .update(opportunityAlerts)
        .set({ notificationId })
        .where(
          and(
            eq(opportunityAlerts.opportunityId, opportunityId),
            eq(opportunityAlerts.providerProfileId, match.providerProfileId),
          ),
        );
      alerted += 1;
      continue;
    }

    if (existing.realertedAt) continue; // one re-alert max, ever

    const gradeImproved = existing.matchGrade === "close" && match.evaluation.grade === "exact";
    const snapshot = (existing.score as { paySnapshot?: { cents: number | null; unit: string | null } })
      .paySnapshot;
    const newPay = ctx.opp.payMaxCents ?? ctx.opp.payMinCents;
    const payRose =
      snapshot?.cents != null &&
      newPay != null &&
      snapshot.unit === ctx.opp.payUnit &&
      newPay >= MATCHING.realertPayIncrease * snapshot.cents;
    if (!gradeImproved && !payRose) continue;

    const notificationId = await dispatchOpportunityAlert(serviceDb, {
      userId: match.userId,
      ctx,
      grade: match.evaluation.grade,
      notes: [
        gradeImproved ? "now an exact match for your zone" : "pay was increased",
        ...alertNotes(match.evaluation),
      ],
      zoneName: match.evaluation.zone.zoneName,
      channels: {
        inApp: match.evaluation.zone.channelInApp,
        email: match.evaluation.zone.channelEmail,
        sms: match.evaluation.zone.channelSms,
      },
      forceSms,
      realert: true,
    });
    await serviceDb
      .update(opportunityAlerts)
      .set({
        matchGrade: match.evaluation.grade,
        score: scoreJson(match.evaluation, ctx),
        watchZoneId: match.evaluation.zone.zoneId,
        notificationId,
        realertedAt: sql`now()`,
      })
      .where(
        and(
          eq(opportunityAlerts.opportunityId, opportunityId),
          eq(opportunityAlerts.providerProfileId, match.providerProfileId),
        ),
      );
    realerted += 1;
  }

  console.log(`[fanout-updated] ${opportunityId}: ${matches.length} matched, ${alerted} new, ${realerted} re-alerts`);
  return { matched: matches.length, alerted, realerted };
}
