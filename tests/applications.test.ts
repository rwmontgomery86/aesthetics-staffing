import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { dbAs, endRlsPool } from "@/db/client";
import { serviceDb, servicePool } from "@/db/service";
import {
  applications,
  bookingOccurrences,
  bookings,
  opportunities,
  opportunityOccurrences,
  profileAccessGrants,
  profiles,
} from "@/db/schema";
import { assertApplicationTransition } from "@/lib/state/application";
import { assertBookingTransition } from "@/lib/state/booking";
import { cleanupBookings, createOrg, createProvider, createPostedOpportunity } from "./helpers/fixtures";

/**
 * Phase 7 model + RLS proofs: application uniqueness, the grant gate,
 * party-only visibility, the provider-books-own-offer insert path, the
 * contact-reveal policy, and the occurrence slot trigger (including the
 * slot_count-2 stress case and the overbooking stop).
 */

afterAll(async () => {
  await cleanupBookings();
  await serviceDb.execute(sql`delete from auth.users where email like '%@test.local'`);
  await serviceDb.execute(sql`delete from organizations where name like 'rlstest-%'`);
  await endRlsPool();
  await servicePool.end();
});

async function addOccurrence(opportunityId: string, startsInHours: number, lengthHours = 8) {
  const startsAt = new Date(Date.now() + startsInHours * 3600_000);
  const [occ] = await serviceDb
    .insert(opportunityOccurrences)
    .values({
      opportunityId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + lengthHours * 3600_000),
    })
    .returning();
  return occ;
}

/** Org + posted opportunity + N future occurrences. */
async function arrange(label: string, occurrenceHours: number[] = [72]) {
  const { owner, org, location } = await createOrg(`rlstest-${label}`);
  const opp = await createPostedOpportunity(org.id, location.id, owner.id);
  const occurrences = [];
  for (const hours of occurrenceHours) {
    occurrences.push(await addOccurrence(opp.id, hours));
  }
  return { owner, org, location, opp, occurrences };
}

/** What the apply action does at the DB level, as the provider's own RLS user. */
async function applyAs(
  providerUserId: string,
  providerProfileId: string,
  opportunityId: string,
  occurrenceId: string | null = null,
) {
  return dbAs(providerUserId, async (tx) => {
    const inserted = await tx
      .insert(applications)
      .values({
        opportunityId,
        occurrenceId,
        providerProfileId,
        scope: occurrenceId == null ? "series" : "occurrence",
        credentialSnapshot: [],
      })
      .onConflictDoNothing()
      .returning({ id: applications.id });
    return inserted;
  });
}

/** What the accept action does: booking + dates + accepted, as the provider. */
async function acceptAs(
  providerUserId: string,
  providerProfileId: string,
  opp: { id: string; organizationId: string; locationId: string },
  applicationId: string,
  occurrenceIds: string[],
  scope: "series" | "occurrences" = "series",
) {
  const bookingId = crypto.randomUUID();
  await dbAs(providerUserId, async (tx) => {
    await tx.insert(bookings).values({
      id: bookingId,
      opportunityId: opp.id,
      applicationId,
      providerProfileId,
      organizationId: opp.organizationId,
      locationId: opp.locationId,
      scope,
      providerConfirmedAt: new Date(),
      businessConfirmedAt: new Date(),
      termsVersion: "test-1",
      termsAcceptedProviderAt: new Date(),
      termsAcceptedBusinessAt: new Date(),
    });
    if (occurrenceIds.length > 0) {
      await tx
        .insert(bookingOccurrences)
        .values(occurrenceIds.map((occurrenceId) => ({ bookingId, occurrenceId })));
    }
    await tx
      .update(applications)
      .set({ status: "accepted", statusChangedAt: new Date() })
      .where(eq(applications.id, applicationId));
  });
  return bookingId;
}

async function offerVia(ownerId: string, applicationId: string) {
  await dbAs(ownerId, (tx) =>
    tx
      .update(applications)
      .set({ status: "offered", statusChangedAt: new Date() })
      .where(eq(applications.id, applicationId)),
  );
}

describe("state machines", () => {
  it("allows the documented application moves and rejects the rest", () => {
    expect(() => assertApplicationTransition("submitted", "offered")).not.toThrow();
    expect(() => assertApplicationTransition("submitted", "accepted")).not.toThrow();
    expect(() => assertApplicationTransition("offered", "accepted")).not.toThrow();
    expect(() => assertApplicationTransition("offered", "withdrawn")).not.toThrow();
    expect(() => assertApplicationTransition("accepted", "submitted")).toThrow();
    expect(() => assertApplicationTransition("withdrawn", "submitted")).toThrow();
    expect(() => assertApplicationTransition("declined", "offered")).toThrow();
  });

  it("allows the documented booking moves and rejects the rest", () => {
    expect(() => assertBookingTransition("confirmed", "completed")).not.toThrow();
    expect(() => assertBookingTransition("confirmed", "canceled_by_provider")).not.toThrow();
    expect(() => assertBookingTransition("no_show_provider", "disputed")).not.toThrow();
    expect(() => assertBookingTransition("completed", "confirmed")).toThrow();
    expect(() => assertBookingTransition("canceled_by_business", "confirmed")).toThrow();
  });
});

describe("applications", () => {
  it("enforces one series application per provider per opportunity", async () => {
    const { opp } = await arrange("app-unique");
    const provider = await createProvider("app-unique-p");
    const first = await applyAs(provider.user.id, provider.profile.id, opp.id);
    expect(first).toHaveLength(1);
    const second = await applyAs(provider.user.id, provider.profile.id, opp.id);
    expect(second).toHaveLength(0); // partial unique swallows the duplicate
  });

  it("is visible to the provider and the posting org, invisible to everyone else", async () => {
    const { owner, opp } = await arrange("app-vis");
    const provider = await createProvider("app-vis-p");
    const stranger = await createProvider("app-vis-stranger");
    const otherOrg = await createOrg("rlstest-app-vis-other");
    await applyAs(provider.user.id, provider.profile.id, opp.id);

    const mine = await dbAs(provider.user.id, (tx) =>
      tx.select().from(applications).where(eq(applications.opportunityId, opp.id)),
    );
    const orgs = await dbAs(owner.id, (tx) =>
      tx.select().from(applications).where(eq(applications.opportunityId, opp.id)),
    );
    const strangers = await dbAs(stranger.user.id, (tx) =>
      tx.select().from(applications).where(eq(applications.opportunityId, opp.id)),
    );
    const otherOrgs = await dbAs(otherOrg.owner.id, (tx) =>
      tx.select().from(applications).where(eq(applications.opportunityId, opp.id)),
    );
    expect(mine).toHaveLength(1);
    expect(orgs).toHaveLength(1);
    expect(strangers).toHaveLength(0);
    expect(otherOrgs).toHaveLength(0);
  });

  it("an applicant keeps seeing the opportunity after it fills; strangers don't", async () => {
    const { opp } = await arrange("vis-filled");
    const provider = await createProvider("vis-filled-p");
    await applyAs(provider.user.id, provider.profile.id, opp.id);
    await serviceDb.execute(sql`update opportunities set status = 'filled' where id = ${opp.id}`);

    const applicantSees = await dbAs(provider.user.id, (tx) =>
      tx.select().from(opportunities).where(eq(opportunities.id, opp.id)),
    );
    expect(applicantSees).toHaveLength(1); // booked dates/history must not vanish

    const stranger = await createProvider("vis-filled-stranger");
    const strangerSees = await dbAs(stranger.user.id, (tx) =>
      tx.select().from(opportunities).where(eq(opportunities.id, opp.id)),
    );
    expect(strangerSees).toHaveLength(0);
  });

  it("auto-grant reopens after a revoke when the provider re-applies", async () => {
    const { org, opp } = await arrange("app-grant");
    const provider = await createProvider("app-grant-p");
    const [application] = await applyAs(provider.user.id, provider.profile.id, opp.id);

    const upsertGrant = () =>
      dbAs(provider.user.id, (tx) =>
        tx
          .insert(profileAccessGrants)
          .values({
            providerProfileId: provider.profile.id,
            organizationId: org.id,
            grantedVia: "application",
            applicationId: application.id,
          })
          .onConflictDoUpdate({
            target: [profileAccessGrants.providerProfileId, profileAccessGrants.organizationId],
            set: { revokedAt: null, grantedVia: "application", applicationId: application.id },
          }),
      );
    await upsertGrant();

    // Provider revokes; the org's grant-gated view must close.
    await dbAs(provider.user.id, (tx) =>
      tx
        .update(profileAccessGrants)
        .set({ revokedAt: new Date() })
        .where(eq(profileAccessGrants.providerProfileId, provider.profile.id)),
    );
    let [grant] = await serviceDb
      .select()
      .from(profileAccessGrants)
      .where(eq(profileAccessGrants.providerProfileId, provider.profile.id));
    expect(grant.revokedAt).not.toBeNull();

    // Re-apply path runs the same upsert → grant reopens.
    await upsertGrant();
    [grant] = await serviceDb
      .select()
      .from(profileAccessGrants)
      .where(eq(profileAccessGrants.providerProfileId, provider.profile.id));
    expect(grant.revokedAt).toBeNull();
  });
});

describe("booking creation RLS", () => {
  it("lets a provider book themselves ONLY off an offered application", async () => {
    const { owner, opp, occurrences } = await arrange("book-rls");
    const provider = await createProvider("book-rls-p");
    const [application] = await applyAs(provider.user.id, provider.profile.id, opp.id);

    // Not offered yet → the insert policy must refuse.
    await expect(
      acceptAs(provider.user.id, provider.profile.id, opp, application.id, [occurrences[0].id]),
    ).rejects.toThrow();

    await offerVia(owner.id, application.id);
    const bookingId = await acceptAs(
      provider.user.id,
      provider.profile.id,
      opp,
      application.id,
      [occurrences[0].id],
    );
    const [booking] = await serviceDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking.status).toBe("confirmed");
  });

  it("refuses a booking whose org/location don't match the opportunity", async () => {
    const { owner, opp, occurrences } = await arrange("book-pin");
    const decoy = await createOrg("rlstest-book-pin-decoy");
    const provider = await createProvider("book-pin-p");
    const [application] = await applyAs(provider.user.id, provider.profile.id, opp.id);
    await offerVia(owner.id, application.id);

    await expect(
      acceptAs(
        provider.user.id,
        provider.profile.id,
        { id: opp.id, organizationId: decoy.org.id, locationId: opp.locationId },
        application.id,
        [occurrences[0].id],
      ),
    ).rejects.toThrow();
  });
});

describe("contact reveal", () => {
  it("hides the provider's profile row until a booking exists", async () => {
    const { owner, opp, occurrences } = await arrange("reveal");
    const provider = await createProvider("reveal-p");
    await serviceDb
      .update(profiles)
      .set({ phoneE164: "+14045550123" })
      .where(eq(profiles.id, provider.user.id));
    const [application] = await applyAs(provider.user.id, provider.profile.id, opp.id);

    const before = await dbAs(owner.id, (tx) =>
      tx.select().from(profiles).where(eq(profiles.id, provider.user.id)),
    );
    expect(before).toHaveLength(0); // applied, but NOT booked → contact hidden

    await offerVia(owner.id, application.id);
    const bookingId = await acceptAs(
      provider.user.id,
      provider.profile.id,
      opp,
      application.id,
      [occurrences[0].id],
    );

    const after = await dbAs(owner.id, (tx) =>
      tx.select().from(profiles).where(eq(profiles.id, provider.user.id)),
    );
    expect(after).toHaveLength(1);
    expect(after[0].phoneE164).toBe("+14045550123");

    // And the email definer hands each side exactly the counterparty's email.
    const ownerSees = await dbAs(owner.id, (tx) =>
      tx.execute<{ email: string }>(
        sql`select public.booking_counterparty_email(${bookingId}::uuid) as email`,
      ),
    );
    const providerSees = await dbAs(provider.user.id, (tx) =>
      tx.execute<{ email: string }>(
        sql`select public.booking_counterparty_email(${bookingId}::uuid) as email`,
      ),
    );
    expect(ownerSees.rows[0].email).toContain("reveal-p");
    expect(providerSees.rows[0].email).toContain("reveal-owner");

    // A non-party gets nothing from the definer.
    const stranger = await createProvider("reveal-stranger");
    const strangerSees = await dbAs(stranger.user.id, (tx) =>
      tx.execute<{ email: string | null }>(
        sql`select public.booking_counterparty_email(${bookingId}::uuid) as email`,
      ),
    );
    expect(strangerSees.rows[0]?.email ?? null).toBeNull();
  });
});

describe("occurrence slot trigger", () => {
  it("books at slot_count, blocks overbooking, reopens on future cancel", async () => {
    const { opp, occurrences } = await arrange("slots-1");
    const occ = occurrences[0];

    // First confirmed booking fills the single slot.
    const bookingA = crypto.randomUUID();
    await serviceDb.insert(bookings).values({
      id: bookingA,
      opportunityId: opp.id,
      applicationId: (await seedApplication(opp.id)).id,
      providerProfileId: (await createProvider("slots1-a")).profile.id,
      organizationId: opp.organizationId,
      locationId: opp.locationId,
      scope: "occurrences",
    });
    await serviceDb.insert(bookingOccurrences).values({ bookingId: bookingA, occurrenceId: occ.id });

    let [row] = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.id, occ.id));
    expect(row.status).toBe("booked");

    // Second confirmed booking on the same date must hit the overbooking stop.
    const bookingB = crypto.randomUUID();
    await serviceDb.insert(bookings).values({
      id: bookingB,
      opportunityId: opp.id,
      applicationId: (await seedApplication(opp.id)).id,
      providerProfileId: (await createProvider("slots1-b")).profile.id,
      organizationId: opp.organizationId,
      locationId: opp.locationId,
      scope: "occurrences",
    });
    await expect(
      serviceDb.insert(bookingOccurrences).values({ bookingId: bookingB, occurrenceId: occ.id }),
    ).rejects.toThrow(/fully booked/);

    // Canceling the future date reopens it.
    await serviceDb
      .update(bookingOccurrences)
      .set({ status: "canceled_by_provider", canceledAt: new Date() })
      .where(
        and(eq(bookingOccurrences.bookingId, bookingA), eq(bookingOccurrences.occurrenceId, occ.id)),
      );
    [row] = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.id, occ.id));
    expect(row.status).toBe("open");
  });

  it("slot_count-2 stress: provider A Mondays + provider B Wednesdays coexist", async () => {
    const { opp, occurrences } = await arrange("slots-2", [72, 120]);
    await serviceDb.execute(sql`update opportunities set slot_count = 2 where id = ${opp.id}`);
    const [monday, wednesday] = occurrences;
    const a = await createProvider("slots2-a");
    const b = await createProvider("slots2-b");

    const bookFor = async (providerProfileId: string, occurrenceId: string) => {
      const id = crypto.randomUUID();
      await serviceDb.insert(bookings).values({
        id,
        opportunityId: opp.id,
        applicationId: (await seedApplication(opp.id)).id,
        providerProfileId,
        organizationId: opp.organizationId,
        locationId: opp.locationId,
        scope: "occurrences",
      });
      await serviceDb.insert(bookingOccurrences).values({ bookingId: id, occurrenceId });
      return id;
    };

    // Two bookings on one post, different days — both live simultaneously.
    await bookFor(a.profile.id, monday.id);
    await bookFor(b.profile.id, wednesday.id);
    const rows = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.opportunityId, opp.id));
    // One confirmed booking each, slot_count 2 → both days still 'open'.
    expect(rows.every((r) => r.status === "open")).toBe(true);

    // A second provider on Monday fills its 2 slots → 'booked'; Wednesday stays open.
    await bookFor(b.profile.id, monday.id);
    const [mondayRow] = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.id, monday.id));
    const [wednesdayRow] = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.id, wednesday.id));
    expect(mondayRow.status).toBe("booked");
    expect(wednesdayRow.status).toBe("open");
  });

  it("completing a past date never reopens it", async () => {
    const { opp } = await arrange("slots-past", []);
    const pastOcc = await addOccurrence(opp.id, -24, 8); // ended yesterday
    const provider = await createProvider("slots-past-p");
    const bookingId = crypto.randomUUID();
    await serviceDb.insert(bookings).values({
      id: bookingId,
      opportunityId: opp.id,
      applicationId: (await seedApplication(opp.id)).id,
      providerProfileId: provider.profile.id,
      organizationId: opp.organizationId,
      locationId: opp.locationId,
      scope: "occurrences",
    });
    await serviceDb
      .insert(bookingOccurrences)
      .values({ bookingId, occurrenceId: pastOcc.id });
    let [row] = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.id, pastOcc.id));
    expect(row.status).toBe("booked");

    await serviceDb
      .update(bookingOccurrences)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(bookingOccurrences.bookingId, bookingId));
    [row] = await serviceDb
      .select()
      .from(opportunityOccurrences)
      .where(eq(opportunityOccurrences.id, pastOcc.id));
    expect(row.status).toBe("booked"); // past → no reopen; completion is explicit
  });
});

/** Bookings need an application FK; the trigger tests don't care whose. */
async function seedApplication(opportunityId: string) {
  const filler = await createProvider("filler");
  const [application] = await serviceDb
    .insert(applications)
    .values({
      opportunityId,
      providerProfileId: filler.profile.id,
      scope: "series",
      status: "accepted",
    })
    .returning();
  return application;
}
