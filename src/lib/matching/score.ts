import { DateTime } from "luxon";
import { MATCHING } from "@/config/matching";

/**
 * Stage 2 — pure scoring functions (MATCHING_LOGIC.md §2). No I/O: the
 * fanout worker feeds candidates from the SQL prefilter, this module turns
 * soft criteria into a grade. EXACT = all PASS; CLOSE = no FAIL and ≥1 NEAR;
 * any FAIL → no alert.
 */

export type Verdict = "pass" | "near" | "fail";
export type Grade = "exact" | "close";

export interface CriterionScore {
  verdict: Verdict;
  /** Human note carried into the alert copy ("pay structure differs…"). */
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Pay                                                                 */
/* ------------------------------------------------------------------ */

export interface PayFields {
  payKind: string | null;
  payUnit: string | null;
  payMinCents: number | null;
  payMaxCents: number | null;
}

export interface ZonePayFloor {
  minPayCents: number | null;
  minPayUnit: string;
}

/**
 * Best-case comparable pay in the zone's unit, or null when the structures
 * can't be compared (per-treatment / commission / salary vs an hourly floor).
 */
export function comparablePayCents(opp: PayFields, zoneUnit: string): number | null {
  if (opp.payMinCents == null || opp.payUnit == null) return null;
  const best = opp.payMaxCents ?? opp.payMinCents;
  if (opp.payUnit === zoneUnit) return best;
  if (opp.payUnit === "hour" && zoneUnit === "day") return best * MATCHING.hoursPerDay;
  if (opp.payUnit === "day" && zoneUnit === "hour") return Math.round(best / MATCHING.hoursPerDay);
  return null; // incomparable
}

export function scorePay(opp: PayFields, zone: ZonePayFloor): CriterionScore {
  if (zone.minPayCents == null) return { verdict: "pass" };
  // Pay omitted is only legal for non-shift types — auto-PASS per spec.
  if (opp.payMinCents == null) return { verdict: "pass" };

  const comparable = comparablePayCents(opp, zone.minPayUnit);
  if (comparable == null) {
    return { verdict: "near", note: "pay structure differs from your preference" };
  }
  const approx =
    opp.payUnit !== zone.minPayUnit ? " (approximate hour/day conversion)" : "";
  if (comparable >= zone.minPayCents) {
    return approx ? { verdict: "pass", note: `meets your floor${approx}` } : { verdict: "pass" };
  }
  if (comparable >= MATCHING.payTolerance * zone.minPayCents) {
    return {
      verdict: "near",
      note:
        opp.payKind === "negotiable_min"
          ? `negotiable — your floor may be reachable${approx}`
          : `slightly below your pay floor${approx}`,
    };
  }
  return { verdict: "fail" };
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

export function scoreServices(
  oppServiceIds: readonly string[],
  providerServiceIds: ReadonlySet<string>,
): CriterionScore {
  if (oppServiceIds.length === 0) return { verdict: "pass" };
  const overlap = oppServiceIds.filter((id) => providerServiceIds.has(id)).length;
  const ratio = overlap / oppServiceIds.length;
  if (ratio === 1) return { verdict: "pass" };
  if (ratio >= MATCHING.serviceRatioNear && overlap >= 1) {
    return { verdict: "near", note: "covers some but not all requested services" };
  }
  return { verdict: "fail" };
}

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

export interface OccurrenceWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface ZoneSchedule {
  /** 0=Sunday … 6=Saturday. Full set = no day constraint. */
  daysOfWeek: readonly number[];
  /** "HH:MM[:SS]" or null. start > end = window wraps midnight. */
  timeStartLocal: string | null;
  timeEndLocal: string | null;
}

export interface AvailabilityBlock {
  dayOfWeek: number;
  timeStart: string;
  timeEnd: string;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Is [occStart, occStart+dur) inside [winStart, winEnd) with midnight wrap? */
function withinWindow(
  occStartMin: number,
  durMin: number,
  winStartMin: number,
  winEndMin: number,
  slackMin = 0,
): boolean {
  let winLen = (winEndMin - winStartMin + 1440) % 1440;
  if (winLen === 0) winLen = 1440; // identical start/end = whole day
  const start = winStartMin - slackMin;
  const len = winLen + slackMin * 2;
  const rel = (occStartMin - start + 1440 * 2) % 1440;
  return rel + durMin <= len;
}

function occurrenceFits(
  occ: OccurrenceWindow,
  timezone: string,
  zone: ZoneSchedule,
  availability: readonly AvailabilityBlock[],
  slackMin: number,
): boolean {
  const local = DateTime.fromJSDate(occ.startsAt, { zone: timezone });
  const dow = local.weekday % 7;
  const durMin = Math.round((occ.endsAt.getTime() - occ.startsAt.getTime()) / 60000);
  const startMin = local.hour * 60 + local.minute;

  if (zone.daysOfWeek.length > 0 && !zone.daysOfWeek.includes(dow)) return false;

  if (zone.timeStartLocal && zone.timeEndLocal) {
    if (!withinWindow(startMin, durMin, minutes(zone.timeStartLocal), minutes(zone.timeEndLocal), slackMin)) {
      return false;
    }
  }

  // Availability template is advisory: when present, the occurrence must at
  // least OVERLAP a block on that local day (not be contained by one).
  if (availability.length > 0) {
    const endMin = startMin + durMin;
    const overlaps = availability.some((block) => {
      if (block.dayOfWeek !== dow) return false;
      const bs = minutes(block.timeStart);
      const be = minutes(block.timeEnd);
      return startMin < be && endMin > bs;
    });
    if (!overlaps) return false;
  }
  return true;
}

/**
 * @param occurrences Open occurrences inside the horizon (next 30 days), or
 *   the single next upcoming one when the horizon is empty. `null` means the
 *   type has no schedule at all (part_time/full_time/contract/evergreen) —
 *   auto-PASS per spec.
 */
export function scoreSchedule(
  occurrences: readonly OccurrenceWindow[] | null,
  timezone: string,
  zone: ZoneSchedule,
  availability: readonly AvailabilityBlock[],
): CriterionScore {
  if (occurrences === null) return { verdict: "pass" };
  if (occurrences.length === 0) return { verdict: "fail" };

  const fits = occurrences.filter((o) => occurrenceFits(o, timezone, zone, availability, 0)).length;
  if (fits / occurrences.length >= MATCHING.scheduleFitShare) return { verdict: "pass" };
  if (fits >= 1) return { verdict: "near", note: "some dates fit your schedule" };

  const slackFits = occurrences.some((o) =>
    occurrenceFits(o, timezone, zone, availability, MATCHING.nearWindowSlackMin),
  );
  if (slackFits) return { verdict: "near", note: "dates fall just outside your time window" };
  return { verdict: "fail" };
}

/* ------------------------------------------------------------------ */
/* Combine                                                             */
/* ------------------------------------------------------------------ */

export interface ScoreCard {
  pay: CriterionScore;
  services: CriterionScore;
  schedule: CriterionScore;
}

export function combineGrade(card: ScoreCard): Grade | null {
  const verdicts = [card.pay.verdict, card.services.verdict, card.schedule.verdict];
  if (verdicts.includes("fail")) return null;
  if (verdicts.every((v) => v === "pass")) return "exact";
  return "close";
}
