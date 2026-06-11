import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { endRlsPool } from "@/db/client";
import { serviceDb, servicePool } from "@/db/service";
import {
  notificationDeliveries,
  notifications,
  opportunities,
  opportunityAlerts,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
  providerTypes,
  services,
} from "@/db/schema";
import { fanoutOpportunityPosted, fanoutOpportunityUpdated } from "@/lib/matching/fanout";
import { expireOpportunitiesJob, generateOccurrencesJob } from "@/workers/jobs/crons";
import { stopBoss } from "@/lib/queue";
import { createOrg, createProvider } from "./helpers/fixtures";

/**
 * Phase 6 exit criteria, database edition: duplicate fanout runs produce
 * zero duplicate alerts; exact-only zones never receive close; urgent <24h
 * forces SMS for opted-in providers; re-alert fires at most once and only on
 * improvement; crons are idempotent.
 */

afterAll(async () => {
  await serviceDb.execute(sql`delete from auth.users where email like '%@test.local'`);
  await serviceDb.execute(sql`delete from organizations where name like 'rlstest-%'`);
  await stopBoss();
  await endRlsPool();
  await servicePool.end();
});

/**
 * Each test gets its own coordinates ~111 km apart — zones are 16 km buffers,
 * so providers from one test can never match another test's opportunity.
 */
function spot(index: number): { lat: number; lng: number } {
  return { lat: 33 + index, lng: -84 - index };
}

async function taxonomy() {
  const [ptype] = await serviceDb.select().from(providerTypes).limit(1);
  const svc = await serviceDb.select().from(services).limit(2);
  if (!ptype || svc.length < 2) throw new Error("run db:seed first");
  return { ptype, s1: svc[0], s2: svc[1] };
}

/** Org + pinned location + posted opportunity (2 services, 1 provider type). */
async function arrangeOpportunity(
  label: string,
  at: { lat: number; lng: number },
  opts: { urgent?: boolean; startsInHours?: number; payMinCents?: number } = {},
) {
  const { ptype, s1, s2 } = await taxonomy();
  const { org, location, owner } = await createOrg(label);
  await serviceDb.execute(sql`
    update locations set geog = st_setsrid(st_makepoint(${at.lng}, ${at.lat}), 4326)::geography
    where id = ${location.id}
  `);
  const [opp] = await serviceDb
    .insert(opportunities)
    .values({
      organizationId: org.id,
      locationId: location.id,
      postedByUserId: owner.id,
      type: "one_time_shift",
      title: `${label} shift`,
      payKind: "fixed",
      payUnit: "hour",
      payMinCents: opts.payMinCents ?? 9000,
      timezone: "America/New_York",
      status: "posted",
      postedAt: new Date(),
      urgent: opts.urgent ?? false,
    })
    .returning();
  const starts = new Date(Date.now() + (opts.startsInHours ?? 72) * 3600_000);
  await serviceDb.insert(opportunityOccurrences).values({
    opportunityId: opp.id,
    startsAt: starts,
    endsAt: new Date(starts.getTime() + 8 * 3600_000),
  });
  await serviceDb.insert(opportunityServices).values([
    { opportunityId: opp.id, serviceId: s1.id },
    { opportunityId: opp.id, serviceId: s2.id },
  ]);
  await serviceDb.insert(opportunityProviderTypes).values({ opportunityId: opp.id, providerTypeId: ptype.id });
  return { org, opp, ptype, s1, s2 };
}

/** Provider with type, offered services, and one zone over the location. */
async function arrangeProvider(
  label: string,
  at: { lat: number; lng: number },
  ptypeId: string,
  serviceIds: string[],
  zone: { alertGrades?: string; channelSms?: boolean; smsOptIn?: boolean } = {},
) {
  const { user, profile } = await createProvider(label);
  await serviceDb.execute(sql`
    insert into provider_profile_types (provider_profile_id, provider_type_id)
    values (${profile.id}, ${ptypeId})
  `);
  for (const serviceId of serviceIds) {
    await serviceDb.execute(sql`
      insert into provider_services (provider_profile_id, service_id) values (${profile.id}, ${serviceId})
    `);
  }
  if (zone.smsOptIn) {
    await serviceDb.execute(sql`
      update profiles set sms_opted_in = true, phone_verified_at = now(), phone_e164 = '+14045550199'
      where id = ${user.id}
    `);
  }
  await serviceDb.execute(sql`
    insert into watch_zones (provider_profile_id, name, kind, geom, geometry_meta, alert_grades, channel_sms)
    values (${profile.id}, ${label}, 'radius',
            st_buffer(st_setsrid(st_makepoint(${at.lng}, ${at.lat}), 4326)::geography, 16000),
            '{}'::jsonb,
            ${zone.alertGrades ?? "{exact,close}"}::match_grade[],
            ${zone.channelSms ?? false})
  `);
  return { user, profile };
}

async function alertsFor(oppId: string) {
  return serviceDb.select().from(opportunityAlerts).where(eq(opportunityAlerts.opportunityId, oppId));
}

describe("fanout dedup", () => {
  it("running fanout twice produces exactly one alert and one notification", async () => {
    const { opp, ptype, s1, s2 } = await arrangeOpportunity("rlstest-f-dedup", spot(0));
    const provider = await arrangeProvider("rlstest-f-dedup-p", spot(0), ptype.id, [s1.id, s2.id]);

    const first = await fanoutOpportunityPosted(opp.id);
    expect(first.matched).toBe(1);
    expect(first.alerted).toBe(1);

    const second = await fanoutOpportunityPosted(opp.id);
    expect(second.alerted).toBe(0); // dedup ledger

    const alerts = await alertsFor(opp.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].matchGrade).toBe("exact"); // full service coverage, no filters
    expect(alerts[0].notificationId).toBeTruthy();

    const notes = await serviceDb
      .select()
      .from(notifications)
      .where(eq(notifications.userId, provider.user.id));
    expect(notes).toHaveLength(1);
  });
});

describe("grade gating", () => {
  it("an exact-only zone never receives a close match", async () => {
    const { opp, ptype, s1 } = await arrangeOpportunity("rlstest-f-exactonly", spot(1));
    // Provider covers only 1 of 2 services → ratio 0.5 → NEAR → close grade.
    await arrangeProvider("rlstest-f-exactonly-p", spot(1), ptype.id, [s1.id], { alertGrades: "{exact}" });

    const result = await fanoutOpportunityPosted(opp.id);
    expect(result.matched).toBe(0);
    expect(await alertsFor(opp.id)).toHaveLength(0);
  });

  it("the same close match alerts a zone that allows close", async () => {
    const { opp, ptype, s1 } = await arrangeOpportunity("rlstest-f-closeok", spot(2));
    await arrangeProvider("rlstest-f-closeok-p", spot(2), ptype.id, [s1.id]);

    const result = await fanoutOpportunityPosted(opp.id);
    expect(result.alerted).toBe(1);
    const [alert] = await alertsFor(opp.id);
    expect(alert.matchGrade).toBe("close");
  });
});

describe("urgent SMS forcing", () => {
  it("urgent + first date <24h forces an SMS delivery for an opted-in provider despite zone settings", async () => {
    const { opp, ptype, s1, s2 } = await arrangeOpportunity("rlstest-f-urgent", spot(3), {
      urgent: true,
      startsInHours: 12,
    });
    const provider = await arrangeProvider("rlstest-f-urgent-p", spot(3), ptype.id, [s1.id, s2.id], {
      channelSms: false, // zone says no SMS — urgency overrides
      smsOptIn: true,
    });

    await fanoutOpportunityPosted(opp.id);
    const deliveries = await serviceDb
      .select({ channel: notificationDeliveries.channel })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .where(eq(notifications.userId, provider.user.id));
    expect(deliveries.some((d) => d.channel === "sms")).toBe(true);
  });

  it("never forces SMS on a provider who hasn't opted in", async () => {
    const { opp, ptype, s1, s2 } = await arrangeOpportunity("rlstest-f-urgentno", spot(4), {
      urgent: true,
      startsInHours: 12,
    });
    const provider = await arrangeProvider("rlstest-f-urgentno-p", spot(4), ptype.id, [s1.id, s2.id], {
      channelSms: true, // even with the zone asking for SMS
      smsOptIn: false,
    });

    await fanoutOpportunityPosted(opp.id);
    const deliveries = await serviceDb
      .select({ channel: notificationDeliveries.channel })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .where(eq(notifications.userId, provider.user.id));
    expect(deliveries.some((d) => d.channel === "sms")).toBe(false);
  });
});

describe("re-alert policy", () => {
  it("re-alerts once when close improves to exact, never a third time", async () => {
    const { opp, ptype, s1, s2 } = await arrangeOpportunity("rlstest-f-realert", spot(5));
    const provider = await arrangeProvider("rlstest-f-realert-p", spot(5), ptype.id, [s1.id]);

    await fanoutOpportunityPosted(opp.id);
    let [alert] = await alertsFor(opp.id);
    expect(alert.matchGrade).toBe("close");

    // No improvement → no re-alert.
    const unchanged = await fanoutOpportunityUpdated(opp.id);
    expect(unchanged.realerted).toBe(0);

    // Provider gains the second service → exact → one re-alert.
    await serviceDb.execute(sql`
      insert into provider_services (provider_profile_id, service_id) values (${provider.profile.id}, ${s2.id})
    `);
    const improved = await fanoutOpportunityUpdated(opp.id);
    expect(improved.realerted).toBe(1);
    [alert] = await alertsFor(opp.id);
    expect(alert.matchGrade).toBe("exact");
    expect(alert.realertedAt).not.toBeNull();

    // At most once, ever.
    const again = await fanoutOpportunityUpdated(opp.id);
    expect(again.realerted).toBe(0);

    const notes = await serviceDb
      .select()
      .from(notifications)
      .where(eq(notifications.userId, provider.user.id));
    expect(notes).toHaveLength(2); // original + one re-alert
  });
});

describe("crons", () => {
  it("expire-opportunities flips past-deadline posted rows, exactly once", async () => {
    const { opp } = await arrangeOpportunity("rlstest-f-expire", spot(6));
    await serviceDb
      .update(opportunities)
      .set({ expiresAt: new Date(Date.now() - 3600_000) })
      .where(eq(opportunities.id, opp.id));

    await expireOpportunitiesJob();
    await expireOpportunitiesJob(); // idempotent
    const [row] = await serviceDb
      .select({ status: opportunities.status })
      .from(opportunities)
      .where(eq(opportunities.id, opp.id));
    expect(row.status).toBe("expired");
  });

  it("generate-occurrences is idempotent on the unique index", async () => {
    const { org, opp } = await arrangeOpportunity("rlstest-f-genocc", spot(7));
    await serviceDb
      .update(opportunities)
      .set({
        type: "recurring_shift",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE",
        recurrenceLocalStart: "09:00",
        recurrenceDurationMin: 480,
      })
      .where(eq(opportunities.id, opp.id));

    await generateOccurrencesJob();
    const countAfterFirst = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(
        and(
          eq(opportunityOccurrences.opportunityId, opp.id),
          eq(opportunityOccurrences.status, "open"),
        ),
      );
    await generateOccurrencesJob();
    const countAfterSecond = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(
        and(
          eq(opportunityOccurrences.opportunityId, opp.id),
          eq(opportunityOccurrences.status, "open"),
        ),
      );
    expect(countAfterFirst.length).toBeGreaterThan(10); // ~16 over 8 weeks
    expect(countAfterSecond.length).toBe(countAfterFirst.length);
    void org;
  });
});
