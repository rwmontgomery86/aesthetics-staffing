import "server-only";
import { sql } from "drizzle-orm";
import { serviceDb } from "@/db/service";

/**
 * Reach estimate: "~N providers are watching this area." A COUNT(DISTINCT)
 * over Stage 1 of MATCHING_LOGIC.md — the hard prefilter only, no soft
 * scoring — so it's the matching engine's upper bound, which is the honest
 * thing to show a business before posting.
 *
 * Runs on the SERVICE role on purpose (the ESLint fence allows
 * src/lib/matching/**): zones are provider-private under RLS, and the
 * business must never see them — only this aggregate count leaves the module.
 *
 * Schedule filters (days/time windows) are deliberately NOT applied: at
 * estimate time recurring series have many occurrence times, and the cost of
 * a slightly optimistic count beats a misleadingly precise one.
 */

export interface ReachInput {
  /** Location point. */
  lat: number;
  lng: number;
  opportunityType: string;
  serviceIds: string[];
  providerTypeIds: string[];
  organizationId: string;
  urgent: boolean;
  payMinCents: number | null;
  payMaxCents: number | null;
  payUnit: string | null;
}

/** `{a,b,c}` literal — interpolating a JS array into sql`` breaks on empty (rule #5). */
function pgArray(items: ReadonlyArray<string | number>): string {
  return `{${items.join(",")}}`;
}

export async function estimateReach(input: ReachInput): Promise<number> {
  // Coarse pay bound: compare in cents at 85% of the zone floor (the close-
  // match threshold), best-case pay, same units only — different units are
  // "incomparable → NEAR" in the matcher, so they pass the prefilter.
  const comparablePay = input.payMaxCents ?? input.payMinCents;

  const result = await serviceDb.execute<{ total: number | string }>(sql`
    select count(distinct wz.provider_profile_id)::int as total
    from watch_zones wz
    join provider_profiles pp on pp.id = wz.provider_profile_id
    join profiles pr on pr.id = pp.user_id
    where not wz.paused
      and pr.suspended_at is null
      and st_intersects(
        wz.geom,
        st_setsrid(st_makepoint(${input.lng}, ${input.lat}), 4326)::geography
      )
      and (
        cardinality(wz.opportunity_types) = 0
        or ${input.opportunityType}::opportunity_type = any(wz.opportunity_types)
      )
      and (
        cardinality(wz.service_ids) = 0
        or wz.service_ids && ${pgArray(input.serviceIds)}::uuid[]
      )
      and (not wz.urgent_only or ${input.urgent})
      and (
        wz.min_pay_cents is null
        or ${comparablePay}::int is null
        or wz.min_pay_unit::text <> ${input.payUnit ?? ""}
        or ${comparablePay}::int >= 0.85 * wz.min_pay_cents
      )
      and exists (
        select 1 from provider_profile_types ppt
        where ppt.provider_profile_id = pp.id
          and ppt.provider_type_id = any(${pgArray(input.providerTypeIds)}::uuid[])
      )
      and not exists (
        select 1 from org_provider_blocks b
        where b.organization_id = ${input.organizationId}
          and b.provider_profile_id = pp.id
      )
      and not exists (
        select 1 from provider_org_blocks b
        where b.provider_profile_id = pp.id
          and b.organization_id = ${input.organizationId}
      )
  `);

  return Number(result.rows[0]?.total ?? 0);
}
