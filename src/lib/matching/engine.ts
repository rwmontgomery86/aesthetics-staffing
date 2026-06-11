import "server-only";
import { sql, and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { serviceDb } from "@/db/service";
import {
  locations,
  opportunities,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
  organizations,
  providerAvailability,
  providerServices,
} from "@/db/schema";
import { MATCHING } from "@/config/matching";
import type { AvailabilityBlock, OccurrenceWindow } from "./score";

/**
 * Stage 1 — the SQL prefilter (MATCHING_LOGIC.md §1). Service role on
 * purpose: fanout must read across every provider's zones. Hard criteria
 * only; survivors go to the pure scoring pass.
 *
 * hidden_from_search is deliberately NOT a criterion — it hides providers
 * from business search, not from alerts they asked for with a zone.
 */

export interface OpportunityContext {
  opp: typeof opportunities.$inferSelect;
  orgName: string;
  locationCity: string;
  lat: number;
  lng: number;
  serviceIds: string[];
  providerTypeIds: string[];
  /** Horizon occurrences for scoring; null = type has no schedule. */
  occurrences: OccurrenceWindow[] | null;
  /** First upcoming open occurrence (urgent-SMS window check). */
  firstOpenStart: Date | null;
}

export interface ZoneCandidate {
  zoneId: string;
  zoneName: string;
  providerProfileId: string;
  userId: string;
  minPayCents: number | null;
  minPayUnit: string;
  daysOfWeek: number[];
  timeStartLocal: string | null;
  timeEndLocal: string | null;
  alertGrades: string[];
  channelInApp: boolean;
  channelEmail: boolean;
  channelSms: boolean;
}

export interface ProviderScoringData {
  serviceIds: Set<string>;
  availability: AvailabilityBlock[];
}

const SCHEDULED_TYPES = new Set(["one_time_shift", "recurring_shift", "popup_event", "training_event"]);

function pgArray(items: ReadonlyArray<string | number>): string {
  return `{${items.join(",")}}`;
}

export async function loadOpportunityContext(opportunityId: string): Promise<OpportunityContext | null> {
  const [row] = await serviceDb
    .select({
      opp: opportunities,
      orgName: organizations.name,
      locationCity: locations.city,
      lat: sql<number | null>`st_y(${locations.geog}::geometry)`,
      lng: sql<number | null>`st_x(${locations.geog}::geometry)`,
    })
    .from(opportunities)
    .innerJoin(organizations, eq(organizations.id, opportunities.organizationId))
    .innerJoin(locations, eq(locations.id, opportunities.locationId))
    .where(eq(opportunities.id, opportunityId));
  if (!row || row.lat == null || row.lng == null) return null;

  const serviceRows = await serviceDb
    .select({ id: opportunityServices.serviceId })
    .from(opportunityServices)
    .where(eq(opportunityServices.opportunityId, opportunityId));
  const typeRows = await serviceDb
    .select({ id: opportunityProviderTypes.providerTypeId })
    .from(opportunityProviderTypes)
    .where(eq(opportunityProviderTypes.opportunityId, opportunityId));

  let occurrences: OccurrenceWindow[] | null = null;
  let firstOpenStart: Date | null = null;
  if (SCHEDULED_TYPES.has(row.opp.type)) {
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + MATCHING.scheduleHorizonDays * 24 * 3600_000);
    let occRows = await serviceDb
      .select({ startsAt: opportunityOccurrences.startsAt, endsAt: opportunityOccurrences.endsAt })
      .from(opportunityOccurrences)
      .where(
        and(
          eq(opportunityOccurrences.opportunityId, opportunityId),
          eq(opportunityOccurrences.status, "open"),
          gt(opportunityOccurrences.startsAt, now),
          lt(opportunityOccurrences.startsAt, horizonEnd),
        ),
      )
      .orderBy(asc(opportunityOccurrences.startsAt));
    if (occRows.length === 0) {
      // Nothing inside the horizon (e.g. a one-time shift six weeks out):
      // score against the next upcoming date rather than auto-failing.
      occRows = await serviceDb
        .select({ startsAt: opportunityOccurrences.startsAt, endsAt: opportunityOccurrences.endsAt })
        .from(opportunityOccurrences)
        .where(
          and(
            eq(opportunityOccurrences.opportunityId, opportunityId),
            eq(opportunityOccurrences.status, "open"),
            gt(opportunityOccurrences.startsAt, now),
          ),
        )
        .orderBy(asc(opportunityOccurrences.startsAt))
        .limit(1);
    }
    occurrences = occRows;
    firstOpenStart = occRows[0]?.startsAt ?? null;
  }

  return {
    opp: row.opp,
    orgName: row.orgName,
    locationCity: row.locationCity,
    lat: row.lat,
    lng: row.lng,
    serviceIds: serviceRows.map((r) => r.id),
    providerTypeIds: typeRows.map((r) => r.id),
    occurrences,
    firstOpenStart,
  };
}

export async function prefilterCandidates(ctx: OpportunityContext): Promise<ZoneCandidate[]> {
  const comparablePay = ctx.opp.payMaxCents ?? ctx.opp.payMinCents;

  const result = await serviceDb.execute<{
    zone_id: string;
    zone_name: string;
    provider_profile_id: string;
    user_id: string;
    min_pay_cents: number | null;
    min_pay_unit: string;
    days_of_week: number[];
    time_start_local: string | null;
    time_end_local: string | null;
    alert_grades: string[];
    channel_in_app: boolean;
    channel_email: boolean;
    channel_sms: boolean;
  }>(sql`
    select wz.id as zone_id,
           wz.name as zone_name,
           wz.provider_profile_id,
           pp.user_id,
           wz.min_pay_cents,
           wz.min_pay_unit::text as min_pay_unit,
           wz.days_of_week,
           wz.time_start_local::text as time_start_local,
           wz.time_end_local::text as time_end_local,
           wz.alert_grades::text[] as alert_grades,
           wz.channel_in_app, wz.channel_email, wz.channel_sms
    from watch_zones wz
    join provider_profiles pp on pp.id = wz.provider_profile_id
    join profiles pr on pr.id = pp.user_id
    where not wz.paused
      and pr.suspended_at is null
      and st_intersects(
        wz.geom,
        st_setsrid(st_makepoint(${ctx.lng}, ${ctx.lat}), 4326)::geography
      )
      and (
        cardinality(wz.opportunity_types) = 0
        or ${ctx.opp.type}::opportunity_type = any(wz.opportunity_types)
      )
      and (
        cardinality(wz.service_ids) = 0
        or wz.service_ids && ${pgArray(ctx.serviceIds)}::uuid[]
      )
      and (not wz.urgent_only or ${ctx.opp.urgent})
      and (
        wz.min_pay_cents is null
        or ${comparablePay}::int is null
        or wz.min_pay_unit::text <> ${ctx.opp.payUnit ?? ""}
        or ${comparablePay}::int >= ${MATCHING.payTolerance}::float8 * wz.min_pay_cents
      )
      and exists (
        select 1 from provider_profile_types ppt
        where ppt.provider_profile_id = pp.id
          and ppt.provider_type_id = any(${pgArray(ctx.providerTypeIds)}::uuid[])
      )
      and not exists (
        select 1 from org_provider_blocks b
        where b.organization_id = ${ctx.opp.organizationId}
          and b.provider_profile_id = pp.id
      )
      and not exists (
        select 1 from provider_org_blocks b
        where b.provider_profile_id = pp.id
          and b.organization_id = ${ctx.opp.organizationId}
      )
  `);

  return result.rows.map((r) => ({
    zoneId: r.zone_id,
    zoneName: r.zone_name,
    providerProfileId: r.provider_profile_id,
    userId: r.user_id,
    minPayCents: r.min_pay_cents,
    minPayUnit: r.min_pay_unit,
    daysOfWeek: r.days_of_week,
    timeStartLocal: r.time_start_local,
    timeEndLocal: r.time_end_local,
    alertGrades: r.alert_grades,
    channelInApp: r.channel_in_app,
    channelEmail: r.channel_email,
    channelSms: r.channel_sms,
  }));
}

/** Batch-load each candidate provider's offered services + availability template. */
export async function loadProviderScoringData(
  providerProfileIds: string[],
): Promise<Map<string, ProviderScoringData>> {
  const map = new Map<string, ProviderScoringData>();
  if (providerProfileIds.length === 0) return map;
  for (const id of providerProfileIds) {
    map.set(id, { serviceIds: new Set(), availability: [] });
  }
  const services = await serviceDb
    .select({ providerProfileId: providerServices.providerProfileId, serviceId: providerServices.serviceId })
    .from(providerServices)
    .where(inArray(providerServices.providerProfileId, providerProfileIds));
  for (const row of services) {
    map.get(row.providerProfileId)?.serviceIds.add(row.serviceId);
  }
  const availability = await serviceDb
    .select({
      providerProfileId: providerAvailability.providerProfileId,
      dayOfWeek: providerAvailability.dayOfWeek,
      timeStart: providerAvailability.timeStart,
      timeEnd: providerAvailability.timeEnd,
    })
    .from(providerAvailability)
    .where(inArray(providerAvailability.providerProfileId, providerProfileIds));
  for (const row of availability) {
    map.get(row.providerProfileId)?.availability.push({
      dayOfWeek: row.dayOfWeek,
      timeStart: row.timeStart,
      timeEnd: row.timeEnd,
    });
  }
  return map;
}
