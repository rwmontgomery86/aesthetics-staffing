import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { dbAs, endRlsPool } from "@/db/client";
import { serviceDb, servicePool } from "@/db/service";
import {
  applications,
  bookingOccurrences,
  bookings,
  completionRecords,
  notifications,
  opportunities,
  opportunityAlerts,
  opportunityOccurrences,
  opportunityProviderTypes,
  opportunityServices,
  profileAccessGrants,
  providerTypes,
  services,
} from "@/db/schema";
import { fanoutOpportunityPosted } from "@/lib/matching/fanout";
import { notifyEventJob } from "@/workers/jobs/events";
import { stopBoss } from "@/lib/queue";
import { cleanupBookings, createOrg, createProvider } from "./helpers/fixtures";

/**
 * THE SPINE (Phase 7 exit criterion, permanent in CI): one shift travels the
 * whole marketplace — post → alert → apply → offer → accept/book → complete —
 * every user step through the same dbAs() RLS path the app uses, every system
 * step through the real worker functions.
 */

afterAll(async () => {
  await cleanupBookings();
  await serviceDb.execute(sql`delete from auth.users where email like '%@test.local'`);
  await serviceDb.execute(sql`delete from organizations where name like 'rlstest-%'`);
  await stopBoss();
  await endRlsPool();
  await servicePool.end();
});

// Far from every other test file's coordinates (fanout uses lat 33..45).
const AT = { lat: 10, lng: -50 };

async function arrangeWorld() {
  const [ptype] = await serviceDb.select().from(providerTypes).limit(1);
  const svc = await serviceDb.select().from(services).limit(2);
  if (!ptype || svc.length < 2) throw new Error("run db:seed first");

  const { owner, org, location } = await createOrg("rlstest-spine");
  await serviceDb.execute(sql`
    update locations set geog = st_setsrid(st_makepoint(${AT.lng}, ${AT.lat}), 4326)::geography
    where id = ${location.id}
  `);

  const makeProvider = async (label: string) => {
    const { user, profile } = await createProvider(label);
    await serviceDb.execute(sql`
      insert into provider_profile_types (provider_profile_id, provider_type_id)
      values (${profile.id}, ${ptype.id})
    `);
    for (const s of svc) {
      await serviceDb.execute(sql`
        insert into provider_services (provider_profile_id, service_id)
        values (${profile.id}, ${s.id})
      `);
    }
    await serviceDb.execute(sql`
      insert into watch_zones (provider_profile_id, name, kind, geom, geometry_meta)
      values (${profile.id}, ${label}, 'radius',
              st_buffer(st_setsrid(st_makepoint(${AT.lng}, ${AT.lat}), 4326)::geography, 16000),
              '{}'::jsonb)
    `);
    return { user, profile };
  };

  return { owner, org, location, ptype, svc, makeProvider };
}

describe("the spine: post → alert → apply → book → complete", () => {
  it("runs end to end", async () => {
    const { owner, org, location, ptype, svc, makeProvider } = await arrangeWorld();
    const alice = await makeProvider("spine-alice");
    const bob = await makeProvider("spine-bob");

    // ── Post (as the org owner, through RLS) ─────────────────────────────
    const starts = new Date(Date.now() + 72 * 3600_000);
    const oppId = await dbAs(owner.id, async (tx) => {
      const [opp] = await tx
        .insert(opportunities)
        .values({
          organizationId: org.id,
          locationId: location.id,
          postedByUserId: owner.id,
          type: "one_time_shift",
          title: "Spine shift",
          payKind: "fixed",
          payUnit: "hour",
          payMinCents: 9500,
          timezone: "America/New_York",
          status: "posted",
          postedAt: new Date(),
        })
        .returning({ id: opportunities.id });
      await tx
        .insert(opportunityOccurrences)
        .values({ opportunityId: opp.id, startsAt: starts, endsAt: new Date(starts.getTime() + 8 * 3600_000) });
      await tx
        .insert(opportunityServices)
        .values(svc.map((s) => ({ opportunityId: opp.id, serviceId: s.id })));
      await tx
        .insert(opportunityProviderTypes)
        .values({ opportunityId: opp.id, providerTypeId: ptype.id });
      return opp.id;
    });

    // ── Alert (the matching worker) ──────────────────────────────────────
    await fanoutOpportunityPosted(oppId);
    const alerts = await serviceDb
      .select()
      .from(opportunityAlerts)
      .where(eq(opportunityAlerts.opportunityId, oppId));
    expect(alerts.map((a) => a.providerProfileId).sort()).toEqual(
      [alice.profile.id, bob.profile.id].sort(),
    );

    // ── Apply (both providers, as themselves; snapshot + auto-grant) ─────
    const applyAs = (p: { user: { id: string }; profile: { id: string } }) =>
      dbAs(p.user.id, async (tx) => {
        const [application] = await tx
          .insert(applications)
          .values({
            opportunityId: oppId,
            providerProfileId: p.profile.id,
            scope: "series",
            source: "watch_alert",
            credentialSnapshot: [],
          })
          .returning({ id: applications.id });
        await tx
          .insert(profileAccessGrants)
          .values({
            providerProfileId: p.profile.id,
            organizationId: org.id,
            grantedVia: "application",
            applicationId: application.id,
          })
          .onConflictDoUpdate({
            target: [profileAccessGrants.providerProfileId, profileAccessGrants.organizationId],
            set: { revokedAt: null },
          });
        return application.id;
      });
    const aliceApplication = await applyAs(alice);
    await applyAs(bob);
    await notifyEventJob({ kind: "application_received", applicationIds: [aliceApplication] });
    const posterPing = await serviceDb
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, owner.id), eq(notifications.kind, "application_received")),
      );
    expect(posterPing).toHaveLength(1);

    // ── Offer (business side) ────────────────────────────────────────────
    await dbAs(owner.id, (tx) =>
      tx
        .update(applications)
        .set({ status: "offered", statusChangedAt: new Date() })
        .where(eq(applications.id, aliceApplication)),
    );
    await notifyEventJob({ kind: "application_offered", applicationIds: [aliceApplication] });

    // ── Accept → booking (provider side; the RLS-gated self-booking) ─────
    const occurrenceRows = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.opportunityId, oppId));
    const bookingId = crypto.randomUUID();
    await dbAs(alice.user.id, async (tx) => {
      await tx.insert(bookings).values({
        id: bookingId,
        opportunityId: oppId,
        applicationId: aliceApplication,
        providerProfileId: alice.profile.id,
        organizationId: org.id,
        locationId: location.id,
        scope: "series",
        providerConfirmedAt: new Date(),
        businessConfirmedAt: new Date(),
        termsVersion: "spine-test",
        termsAcceptedProviderAt: new Date(),
        termsAcceptedBusinessAt: new Date(),
      });
      await tx
        .insert(bookingOccurrences)
        .values(occurrenceRows.map((occ) => ({ bookingId, occurrenceId: occ.id })));
      await tx
        .update(applications)
        .set({ status: "accepted", statusChangedAt: new Date() })
        .where(eq(applications.id, aliceApplication));
    });

    // The slot trigger booked the date.
    const [bookedOcc] = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.opportunityId, oppId));
    expect(bookedOcc.status).toBe("booked");

    // ── booking_confirmed side effects (worker) ──────────────────────────
    await notifyEventJob({ kind: "booking_confirmed", bookingId });

    const [filledOpp] = await serviceDb
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, oppId));
    expect(filledOpp.status).toBe("filled"); // nothing open remains

    const [bobApplication] = await serviceDb
      .select()
      .from(applications)
      .where(
        and(eq(applications.opportunityId, oppId), eq(applications.providerProfileId, bob.profile.id)),
      );
    expect(bobApplication.status).toBe("expired"); // competing applicant closed

    const bobPing = await serviceDb
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, bob.user.id), eq(notifications.kind, "application_filled")),
      );
    expect(bobPing).toHaveLength(1);

    const confirmPings = await serviceDb
      .select()
      .from(notifications)
      .where(eq(notifications.kind, "booking_confirmed"));
    expect(confirmPings.map((n) => n.userId).sort()).toEqual([alice.user.id, owner.id].sort());

    // Idempotency: re-running the job must not double anything.
    await notifyEventJob({ kind: "booking_confirmed", bookingId });
    const confirmPingsAgain = await serviceDb
      .select()
      .from(notifications)
      .where(eq(notifications.kind, "booking_confirmed"));
    expect(confirmPingsAgain).toHaveLength(confirmPings.length);

    // ── Complete (business writes the record, provider counter-signs) ────
    // Time-travel the date into the past so completion is legal.
    await serviceDb.execute(sql`
      update opportunity_occurrences
      set starts_at = now() - interval '10 hours', ends_at = now() - interval '2 hours'
      where opportunity_id = ${oppId}
    `);
    const recordId = await dbAs(owner.id, async (tx) => {
      await tx
        .update(bookingOccurrences)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(bookingOccurrences.bookingId, bookingId));
      const [record] = await tx
        .insert(completionRecords)
        .values({
          bookingId,
          occurrenceId: bookedOcc.id,
          amountCents: 9500 * 8,
          payUnit: "hour",
          unitsWorked: "8",
        })
        .returning({ id: completionRecords.id });
      return record.id;
    });
    await notifyEventJob({ kind: "completion_recorded", completionRecordId: recordId });

    await dbAs(alice.user.id, (tx) =>
      tx
        .update(completionRecords)
        .set({ status: "confirmed", confirmedByUserId: alice.user.id, confirmedAt: new Date() })
        .where(eq(completionRecords.id, recordId)),
    );
    const [finalRecord] = await serviceDb
      .select()
      .from(completionRecords)
      .where(eq(completionRecords.id, recordId));
    expect(finalRecord.status).toBe("confirmed");
    expect(finalRecord.amountCents).toBe(76000);

    const alicePing = await serviceDb
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, alice.user.id), eq(notifications.kind, "completion_recorded")),
      );
    expect(alicePing).toHaveLength(1);
  });
});
