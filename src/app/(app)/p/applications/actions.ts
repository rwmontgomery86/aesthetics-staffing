"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { dbAs, type Tx } from "@/db/client";
import {
  applications,
  bookingOccurrences,
  bookings,
  opportunities,
  opportunityOccurrences,
} from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { providerInTx } from "@/lib/provider";
import { enqueueNotifyEvent, tryEnqueue } from "@/lib/queue";
import { assertApplicationTransition, type ApplicationStatus } from "@/lib/state/application";
import { TERMS_VERSION } from "@/config/terms";

const BACK = "/p/applications";

function fail(message: string): never {
  redirect(`${BACK}?error=${encodeURIComponent(message)}`);
}

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

const groupSchema = z.object({ opportunityId: z.string().uuid() });

/** A provider's pending rows on one opportunity, treated as one candidacy. */
async function myApplicationsFor(
  tx: Tx,
  providerProfileId: string,
  opportunityId: string,
  statuses: ApplicationStatus[],
) {
  return tx
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.opportunityId, opportunityId),
        eq(applications.providerProfileId, providerProfileId),
        inArray(applications.status, statuses),
      ),
    )
    .orderBy(asc(applications.createdAt));
}

/**
 * The provider's half of the dual confirmation (USER_FLOWS §9): the business
 * already clicked through the terms when it made the offer; accepting creates
 * the bookings row — which is what reveals contact info, via RLS — plus a
 * booking_occurrences row per booked date. The occurrence-status flip to
 * 'booked' happens in the sync trigger, since the provider has no UPDATE
 * right on opportunity_occurrences.
 */
export async function acceptOfferAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = groupSchema.safeParse({ opportunityId: formData.get("opportunityId") });
  if (!parsed.success) redirect(BACK);
  const { opportunityId } = parsed.data;
  if (formData.get("termsAccepted") !== "on") {
    fail("Accept the booking terms to confirm.");
  }

  let bookingId = "";
  try {
    bookingId = await dbAs(user, async (tx) => {
      const provider = await providerInTx(tx, user.id);
      const offered = await myApplicationsFor(tx, provider.id, opportunityId, ["offered"]);
      if (offered.length === 0) fail("That offer is no longer available.");

      const [opp] = await tx
        .select({
          id: opportunities.id,
          organizationId: opportunities.organizationId,
          locationId: opportunities.locationId,
          status: opportunities.status,
        })
        .from(opportunities)
        .where(eq(opportunities.id, opportunityId));
      if (!opp || opp.status !== "posted") {
        fail("This opportunity is no longer active — ask the business to re-post it.");
      }

      const seriesRow = offered.find((row) => row.occurrenceId == null);
      let occurrenceIds: string[];
      if (seriesRow) {
        occurrenceIds = (
          await tx
            .select({ id: opportunityOccurrences.id })
            .from(opportunityOccurrences)
            .where(
              and(
                eq(opportunityOccurrences.opportunityId, opportunityId),
                eq(opportunityOccurrences.status, "open"),
                gt(opportunityOccurrences.startsAt, new Date()),
              ),
            )
            .orderBy(asc(opportunityOccurrences.startsAt))
        ).map((row) => row.id);
      } else {
        const wanted = offered.map((row) => row.occurrenceId!).filter(Boolean);
        occurrenceIds = (
          await tx
            .select({ id: opportunityOccurrences.id })
            .from(opportunityOccurrences)
            .where(
              and(
                inArray(opportunityOccurrences.id, wanted),
                eq(opportunityOccurrences.status, "open"),
                gt(opportunityOccurrences.startsAt, new Date()),
              ),
            )
            .orderBy(asc(opportunityOccurrences.startsAt))
        ).map((row) => row.id);
        if (occurrenceIds.length === 0) {
          fail("Those dates were filled or canceled in the meantime.");
        }
      }

      // Both confirmation timestamps live on the booking: the business's is
      // the moment it offered (its terms click-through), the provider's is now.
      const offeredAt = offered
        .map((row) => row.statusChangedAt)
        .reduce((a, b) => (a > b ? a : b));
      const now = new Date();
      const id = randomUUID();
      await tx.insert(bookings).values({
        id,
        opportunityId,
        applicationId: (seriesRow ?? offered[0]).id,
        providerProfileId: provider.id,
        organizationId: opp.organizationId,
        locationId: opp.locationId,
        scope: seriesRow ? "series" : "occurrences",
        providerConfirmedAt: now,
        businessConfirmedAt: offeredAt,
        termsVersion: TERMS_VERSION,
        termsAcceptedProviderAt: now,
        termsAcceptedBusinessAt: offeredAt,
      });
      if (occurrenceIds.length > 0) {
        await tx
          .insert(bookingOccurrences)
          .values(occurrenceIds.map((occurrenceId) => ({ bookingId: id, occurrenceId })));
      }

      for (const row of offered) assertApplicationTransition(row.status, "accepted");
      await tx
        .update(applications)
        .set({ status: "accepted", statusChangedAt: now })
        .where(inArray(applications.id, offered.map((row) => row.id)));

      await tx.execute(sql`
        select public.record_audit(
          'provider', 'booking.confirmed', 'booking', ${id}::uuid, ${opp.organizationId}::uuid,
          ${JSON.stringify({
            applicationIds: offered.map((row) => row.id),
            scope: seriesRow ? "series" : "occurrences",
            occurrenceCount: occurrenceIds.length,
            termsVersion: TERMS_VERSION,
          })}::jsonb
        )
      `);
      return id;
    });
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    // Most likely the overbooking stop in the sync trigger: another provider
    // took the last slot between page load and confirm.
    console.error("[accept-offer]", err);
    fail("One of those dates was just filled by someone else — review what's still open.");
  }

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "booking_confirmed", bookingId }),
    "notify-booking-confirmed",
  );
  redirect(
    `/p/bookings/${bookingId}?notice=` +
      encodeURIComponent("Booked! Contact details are now visible below."),
  );
}

export async function declineOfferAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = groupSchema.safeParse({ opportunityId: formData.get("opportunityId") });
  if (!parsed.success) redirect(BACK);
  const { opportunityId } = parsed.data;

  const ids = await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    const offered = await myApplicationsFor(tx, provider.id, opportunityId, ["offered"]);
    if (offered.length === 0) fail("That offer is no longer available.");
    for (const row of offered) assertApplicationTransition(row.status, "declined");
    await tx
      .update(applications)
      .set({ status: "declined", statusChangedAt: new Date() })
      .where(inArray(applications.id, offered.map((row) => row.id)));
    return offered.map((row) => row.id);
  });

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "application_declined", applicationIds: ids, by: "provider" }),
    "notify-offer-declined",
  );
  redirect(`${BACK}?notice=` + encodeURIComponent("Offer declined."));
}

export async function withdrawApplicationAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = groupSchema.safeParse({ opportunityId: formData.get("opportunityId") });
  if (!parsed.success) redirect(BACK);
  const { opportunityId } = parsed.data;

  const ids = await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);
    const active = await myApplicationsFor(tx, provider.id, opportunityId, [
      "submitted",
      "viewed",
      "shortlisted",
      "offered",
    ]);
    if (active.length === 0) fail("There's nothing to withdraw on that opportunity.");
    for (const row of active) assertApplicationTransition(row.status, "withdrawn");
    await tx
      .update(applications)
      .set({ status: "withdrawn", statusChangedAt: new Date() })
      .where(inArray(applications.id, active.map((row) => row.id)));
    return active.map((row) => row.id);
  });

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "application_withdrawn", applicationIds: ids }),
    "notify-application-withdrawn",
  );
  redirect(`${BACK}?notice=` + encodeURIComponent("Application withdrawn."));
}
