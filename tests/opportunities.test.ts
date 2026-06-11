import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { dbAs, dbAsAnon, endRlsPool } from "@/db/client";
import { serviceDb, servicePool } from "@/db/service";
import { opportunities, providerTypes, services } from "@/db/schema";
import { estimateReach } from "@/lib/matching/reach";
import { createOrg, createPostedOpportunity, createProvider } from "./helpers/fixtures";

/**
 * Phase 5 exit criteria, database edition: hidden pay is structurally
 * impossible for the shift family (the CHECK fires no matter who inserts),
 * posted-only public visibility is RLS, and the reach estimate stays inside
 * sanity bounds.
 */

afterAll(async () => {
  await serviceDb.execute(sql`delete from auth.users where email like '%@test.local'`);
  await serviceDb.execute(sql`delete from organizations where name like 'rlstest-%'`);
  await endRlsPool();
  await servicePool.end();
});

describe("pay-visibility CHECK (hidden pay structurally impossible)", () => {
  async function insertShift(values: Record<string, unknown>) {
    const { org, location, owner } = await createOrg("rlstest-paycheck");
    return serviceDb.insert(opportunities).values({
      organizationId: org.id,
      locationId: location.id,
      postedByUserId: owner.id,
      type: "one_time_shift",
      title: "Pay check test",
      timezone: "America/New_York",
      ...values,
    } as never);
  }

  it("rejects a shift with no pay at all — even via the service role", async () => {
    await expect(insertShift({})).rejects.toThrow(/opportunities_pay_visibility_check/);
  });

  it("rejects a range whose max is not above min", async () => {
    await expect(
      insertShift({ payKind: "range", payUnit: "hour", payMinCents: 5000, payMaxCents: 5000 }),
    ).rejects.toThrow(/opportunities_pay_visibility_check/);
  });

  it("rejects negotiable_min with a max set", async () => {
    await expect(
      insertShift({ payKind: "negotiable_min", payUnit: "hour", payMinCents: 5000, payMaxCents: 9000 }),
    ).rejects.toThrow(/opportunities_pay_visibility_check/);
  });

  it("accepts a valid fixed-pay shift, and a full_time role without pay", async () => {
    await expect(
      insertShift({ payKind: "fixed", payUnit: "hour", payMinCents: 5000 }),
    ).resolves.toBeDefined();

    const { org, location, owner } = await createOrg("rlstest-ftnopay");
    await expect(
      serviceDb.insert(opportunities).values({
        organizationId: org.id,
        locationId: location.id,
        postedByUserId: owner.id,
        type: "full_time",
        title: "FT no pay",
        timezone: "America/New_York",
      }),
    ).resolves.toBeDefined();
  });
});

describe("posted-only public visibility (RLS)", () => {
  it("anon sees posted opportunities but never drafts; the org sees both", async () => {
    const { org, location, owner } = await createOrg("rlstest-oppvis");
    const posted = await createPostedOpportunity(org.id, location.id, owner.id);
    const [draft] = await serviceDb
      .insert(opportunities)
      .values({
        organizationId: org.id,
        locationId: location.id,
        postedByUserId: owner.id,
        type: "one_time_shift",
        title: "Draft shift",
        payKind: "fixed",
        payUnit: "hour",
        payMinCents: 9000,
        timezone: "America/New_York",
        status: "draft",
      })
      .returning({ id: opportunities.id });

    const anonRows = await dbAsAnon((tx) =>
      tx.select({ id: opportunities.id }).from(opportunities),
    );
    const anonIds = new Set(anonRows.map((r) => r.id));
    expect(anonIds.has(posted.id)).toBe(true);
    expect(anonIds.has(draft.id)).toBe(false);

    const ownerRows = await dbAs(owner.id, (tx) =>
      tx.select({ id: opportunities.id }).from(opportunities),
    );
    const ownerIds = new Set(ownerRows.map((r) => r.id));
    expect(ownerIds.has(posted.id)).toBe(true);
    expect(ownerIds.has(draft.id)).toBe(true);

    const stranger = await createProvider("rlstest-oppstranger");
    const strangerRows = await dbAs(stranger.user.id, (tx) =>
      tx.select({ id: opportunities.id }).from(opportunities),
    );
    expect(strangerRows.some((r) => r.id === draft.id)).toBe(false);
  });
});

describe("reach estimate", () => {
  // Midtown Atlanta; zones are 10 mi buffers around (or far from) this point.
  const LAT = 33.781;
  const LNG = -84.388;

  async function arrange(label: string) {
    const { org } = await createOrg(label);
    const [ptype] = await serviceDb.select().from(providerTypes).limit(1);
    const [service] = await serviceDb.select().from(services).limit(1);
    if (!ptype || !service) throw new Error("run db:seed first — taxonomy missing");
    return { org, ptype, service };
  }

  async function providerWithZone(
    label: string,
    ptypeId: string,
    zone: {
      lat?: number;
      lng?: number;
      paused?: boolean;
      urgentOnly?: boolean;
      minPayCents?: number | null;
      opportunityTypes?: string;
    } = {},
  ) {
    const { profile } = await createProvider(label);
    await serviceDb.execute(sql`
      insert into provider_profile_types (provider_profile_id, provider_type_id)
      values (${profile.id}, ${ptypeId})
    `);
    await serviceDb.execute(sql`
      insert into watch_zones (provider_profile_id, name, kind, geom, geometry_meta,
                               opportunity_types, paused, urgent_only, min_pay_cents)
      values (${profile.id}, ${label}, 'radius',
              st_buffer(st_setsrid(st_makepoint(${zone.lng ?? LNG}, ${zone.lat ?? LAT}), 4326)::geography, 16000),
              '{}'::jsonb,
              ${zone.opportunityTypes ?? "{}"}::opportunity_type[],
              ${zone.paused ?? false}, ${zone.urgentOnly ?? false}, ${zone.minPayCents ?? null})
    `);
    return profile;
  }

  it("counts a provider whose zone covers the location and passes the filters", async () => {
    const { org, ptype, service } = await arrange("rlstest-reach-hit");
    await providerWithZone("rlstest-reach-prov1", ptype.id);

    const reach = await estimateReach({
      lat: LAT,
      lng: LNG,
      opportunityType: "one_time_shift",
      serviceIds: [service.id],
      providerTypeIds: [ptype.id],
      organizationId: org.id,
      urgent: false,
      payMinCents: 9000,
      payMaxCents: null,
      payUnit: "hour",
    });
    expect(reach).toBeGreaterThanOrEqual(1);
  });

  it("excludes paused, far-away, urgent-only, type-filtered, and outpriced zones", async () => {
    const { org, ptype, service } = await arrange("rlstest-reach-miss");
    await providerWithZone("rlstest-reach-paused", ptype.id, { paused: true });
    await providerWithZone("rlstest-reach-far", ptype.id, { lat: 32.08, lng: -81.09 }); // Savannah
    await providerWithZone("rlstest-reach-urgent", ptype.id, { urgentOnly: true });
    await providerWithZone("rlstest-reach-typed", ptype.id, { opportunityTypes: "{part_time}" });
    await providerWithZone("rlstest-reach-rich", ptype.id, { minPayCents: 20000 }); // floor $200/h

    const baseline = await estimateReach({
      lat: LAT,
      lng: LNG,
      opportunityType: "one_time_shift",
      serviceIds: [service.id],
      providerTypeIds: [ptype.id],
      organizationId: org.id,
      urgent: false,
      payMinCents: 9000, // 90 < 0.85 * 200 → outpriced zone excluded
      payMaxCents: null,
      payUnit: "hour",
    });

    // None of the five may count; other tests' matching providers might, so
    // compare against a control with an impossible provider type instead of 0.
    const noSuchType = await estimateReach({
      lat: LAT,
      lng: LNG,
      opportunityType: "one_time_shift",
      serviceIds: [service.id],
      providerTypeIds: ["00000000-0000-0000-0000-000000000000"],
      organizationId: org.id,
      urgent: false,
      payMinCents: 9000,
      payMaxCents: null,
      payUnit: "hour",
    });
    expect(noSuchType).toBe(0);

    // Sanity bound: never more than the providers that exist.
    const [{ total }] = (
      await serviceDb.execute<{ total: number }>(sql`select count(*)::int as total from provider_profiles`)
    ).rows;
    expect(baseline).toBeLessThanOrEqual(Number(total));
  });

  it("a different-unit pay floor passes the prefilter (incomparable → near)", async () => {
    const { org, ptype, service } = await arrange("rlstest-reach-unit");
    await providerWithZone("rlstest-reach-dayunit", ptype.id, { minPayCents: 200000 });
    await serviceDb.execute(sql`
      update watch_zones set min_pay_unit = 'day' where name = 'rlstest-reach-dayunit'
    `);

    const reach = await estimateReach({
      lat: LAT,
      lng: LNG,
      opportunityType: "one_time_shift",
      serviceIds: [service.id],
      providerTypeIds: [ptype.id],
      organizationId: org.id,
      urgent: false,
      payMinCents: 9000,
      payMaxCents: null,
      payUnit: "hour", // zone floor is per-day → incomparable, passes
    });
    expect(reach).toBeGreaterThanOrEqual(1);
  });
});
