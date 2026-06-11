"use server";

import { redirect } from "next/navigation";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { dbAs, type Tx } from "@/db/client";
import {
  bookingOccurrences,
  bookings,
  completionRecords,
  opportunities,
  opportunityOccurrences,
} from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { requireOrgRole } from "@/lib/auth/guards";
import {
  cancelDate,
  cancelSeries,
  disputeNoShow,
  loadBookingOccurrence,
  reportNoShow,
} from "@/lib/bookings/mutations";
import { enqueueNotifyEvent, tryEnqueue, type NotifyEvent } from "@/lib/queue";
import { assertOccurrenceTransition } from "@/lib/state/opportunity";

function back(bookingId: string): string {
  return `/b/bookings/${bookingId}`;
}

function fail(backTo: string, message: string): never {
  redirect(`${backTo}?error=${encodeURIComponent(message)}`);
}

const bookingSchema = z.object({
  organizationId: z.string().uuid(),
  bookingId: z.string().uuid(),
  reason: z.string().trim().max(1000).default(""),
});

const dateSchema = bookingSchema.extend({ occurrenceId: z.string().uuid() });

/** Booking pinned to the acting org (RLS plus an explicit app check). */
async function orgBooking(tx: Tx, organizationId: string, bookingId: string) {
  const [booking] = await tx
    .select({
      id: bookings.id,
      status: bookings.status,
      organizationId: bookings.organizationId,
      opportunityId: bookings.opportunityId,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, organizationId)));
  if (!booking) redirect("/b/bookings");
  return booking;
}

async function parseBooking(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = bookingSchema.safeParse({
    organizationId: formData.get("organizationId"),
    bookingId: formData.get("bookingId"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) redirect("/b/bookings");
  await requireOrgRole(parsed.data.organizationId, "poster");
  return { user, data: parsed.data };
}

async function parseDate(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = dateSchema.safeParse({
    organizationId: formData.get("organizationId"),
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) redirect("/b/bookings");
  await requireOrgRole(parsed.data.organizationId, "poster");
  return { user, data: parsed.data };
}

export async function cancelBookingAction(formData: FormData) {
  const { user, data } = await parseBooking(formData);
  const { organizationId, bookingId, reason } = data;
  if (!reason) fail(back(bookingId), "Add a short reason — the provider sees it.");

  await dbAs(user, async (tx) => {
    const booking = await orgBooking(tx, organizationId, bookingId);
    if (booking.status !== "confirmed") fail(back(bookingId), "This booking is already closed.");
    await cancelSeries(tx, booking, "business", user.id, reason);
    await tx.execute(sql`
      select public.record_audit('org_member', 'booking.canceled', 'booking',
        ${bookingId}::uuid, ${organizationId}::uuid,
        ${JSON.stringify({ scope: "series", reason })}::jsonb)
    `);
  });
  await tryEnqueue(
    () =>
      enqueueNotifyEvent({ kind: "booking_canceled", bookingId, occurrenceIds: null, by: "business" }),
    "notify-booking-canceled",
  );
  redirect(`${back(bookingId)}?notice=` + encodeURIComponent("Booking canceled."));
}

export async function cancelBookingDateAction(formData: FormData) {
  const { user, data } = await parseDate(formData);
  const { organizationId, bookingId, occurrenceId, reason } = data;
  if (!reason) fail(back(bookingId), "Add a short reason — the provider sees it.");

  await dbAs(user, async (tx) => {
    await orgBooking(tx, organizationId, bookingId);
    const occurrence = await loadBookingOccurrence(tx, bookingId, occurrenceId);
    if (!occurrence || occurrence.status !== "confirmed") {
      fail(back(bookingId), "That date isn't an active booking anymore.");
    }
    if (occurrence.startsAt <= new Date()) {
      fail(back(bookingId), "Past dates can't be canceled — use complete or no-show instead.");
    }
    await cancelDate(tx, bookingId, occurrence, "business", reason);
    await tx.execute(sql`
      select public.record_audit('org_member', 'booking.date_canceled', 'booking',
        ${bookingId}::uuid, ${organizationId}::uuid,
        ${JSON.stringify({ occurrenceId, reason })}::jsonb)
    `);
  });
  await tryEnqueue(
    () =>
      enqueueNotifyEvent({
        kind: "booking_canceled",
        bookingId,
        occurrenceIds: [occurrenceId],
        by: "business",
      }),
    "notify-booking-date-canceled",
  );
  redirect(`${back(bookingId)}?notice=` + encodeURIComponent("Date canceled."));
}

/** The business reporting that the PROVIDER didn't show. */
export async function reportNoShowAction(formData: FormData) {
  const { user, data } = await parseDate(formData);
  const { organizationId, bookingId, occurrenceId, reason } = data;

  let event: NotifyEvent | null = null;
  await dbAs(user, async (tx) => {
    await orgBooking(tx, organizationId, bookingId);
    const occurrence = await loadBookingOccurrence(tx, bookingId, occurrenceId);
    if (!occurrence || occurrence.status !== "confirmed") {
      fail(back(bookingId), "Only active booked dates can be reported.");
    }
    if (occurrence.endsAt > new Date()) {
      fail(back(bookingId), "You can report a no-show once the date has passed.");
    }
    const absent = await reportNoShow(tx, bookingId, occurrence, "business", user.id, reason);
    event = { kind: "no_show_reported", bookingId, occurrenceId, absent };
    await tx.execute(sql`
      select public.record_audit('org_member', 'booking.no_show_reported', 'booking',
        ${bookingId}::uuid, ${organizationId}::uuid,
        ${JSON.stringify({ occurrenceId, absent })}::jsonb)
    `);
  });
  if (event) await tryEnqueue(() => enqueueNotifyEvent(event!), "notify-no-show");
  redirect(
    `${back(bookingId)}?notice=` +
      encodeURIComponent("No-show recorded. Our team can step in if it's contested."),
  );
}

/** Disputing a no-show report that was filed AGAINST the business. */
export async function disputeNoShowAction(formData: FormData) {
  const { user, data } = await parseDate(formData);
  const { organizationId, bookingId, occurrenceId } = data;

  await dbAs(user, async (tx) => {
    await orgBooking(tx, organizationId, bookingId);
    const occurrence = await loadBookingOccurrence(tx, bookingId, occurrenceId);
    if (!occurrence || !(await disputeNoShow(tx, bookingId, occurrence, "business"))) {
      fail(back(bookingId), "There's no report against you to dispute on that date.");
    }
    await tx.execute(sql`
      select public.record_audit('org_member', 'booking.no_show_disputed', 'booking',
        ${bookingId}::uuid, ${organizationId}::uuid,
        ${JSON.stringify({ occurrenceId })}::jsonb)
    `);
  });
  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "no_show_disputed", bookingId, occurrenceId }),
    "notify-no-show-disputed",
  );
  redirect(
    `${back(bookingId)}?notice=` +
      encodeURIComponent("Dispute recorded — our team will take a look."),
  );
}

const completeSchema = z.object({
  organizationId: z.string().uuid(),
  bookingId: z.string().uuid(),
  occurrenceId: z.string().uuid(),
  unitsWorked: z.coerce.number().positive().max(10000).optional(),
  rate: z.coerce.number().positive().max(1000000).optional(),
  notes: z.string().trim().max(1000).default(""),
});

/**
 * Completion (USER_FLOWS §10): the date is marked done and an invoice-ready
 * completion record is written — amount from the booked terms, units editable
 * for hourly/per-treatment work. No money moves; the provider counter-signs.
 */
export async function completeOccurrenceAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = completeSchema.safeParse({
    organizationId: formData.get("organizationId"),
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    unitsWorked: formData.get("unitsWorked") || undefined,
    rate: formData.get("rate") || undefined,
    notes: String(formData.get("notes") ?? ""),
  });
  if (!parsed.success) redirect("/b/bookings");
  const { organizationId, bookingId, occurrenceId, unitsWorked, rate, notes } = parsed.data;
  await requireOrgRole(organizationId, "poster");

  let completionRecordId = "";
  await dbAs(user, async (tx) => {
    const booking = await orgBooking(tx, organizationId, bookingId);
    const occurrence = await loadBookingOccurrence(tx, bookingId, occurrenceId);
    if (!occurrence || occurrence.status !== "confirmed") {
      fail(back(bookingId), "That date isn't an active booking anymore.");
    }
    if (occurrence.endsAt > new Date()) {
      fail(back(bookingId), "Dates can be completed once they've ended.");
    }

    const [opp] = await tx
      .select({ payUnit: opportunities.payUnit, payMinCents: opportunities.payMinCents })
      .from(opportunities)
      .where(eq(opportunities.id, booking.opportunityId));

    const payUnit = opp?.payUnit ?? "flat";
    const defaultUnits =
      payUnit === "hour"
        ? Math.round(((occurrence.endsAt.getTime() - occurrence.startsAt.getTime()) / 3600_000) * 100) / 100
        : 1;
    const units = unitsWorked ?? defaultUnits;
    const rateCents = rate != null ? Math.round(rate * 100) : (opp?.payMinCents ?? 0);
    const amountCents = Math.round(rateCents * units);
    if (amountCents <= 0) {
      fail(back(bookingId), "Set the rate (and units) so the record has an amount.");
    }

    await tx
      .update(bookingOccurrences)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(
          eq(bookingOccurrences.bookingId, bookingId),
          eq(bookingOccurrences.occurrenceId, occurrenceId),
        ),
      );

    // The occurrence itself completes once no other confirmed booking remains
    // on it (slot_count > 1 can have a second provider still active).
    const [other] = await tx
      .select({ bookingId: bookingOccurrences.bookingId })
      .from(bookingOccurrences)
      .where(
        and(
          eq(bookingOccurrences.occurrenceId, occurrenceId),
          eq(bookingOccurrences.status, "confirmed"),
          ne(bookingOccurrences.bookingId, bookingId),
        ),
      )
      .limit(1);
    if (!other && occurrence.occurrenceStatus !== "completed") {
      assertOccurrenceTransition(occurrence.occurrenceStatus, "completed");
      await tx
        .update(opportunityOccurrences)
        .set({ status: "completed" })
        .where(eq(opportunityOccurrences.id, occurrenceId));
    }

    const [record] = await tx
      .insert(completionRecords)
      .values({
        bookingId,
        occurrenceId,
        amountCents,
        payUnit,
        unitsWorked: units.toString(),
        notes: notes || null,
      })
      .returning({ id: completionRecords.id });
    completionRecordId = record.id;

    await tx.execute(sql`
      select public.record_audit('org_member', 'booking.completed', 'booking',
        ${bookingId}::uuid, ${organizationId}::uuid,
        ${JSON.stringify({ occurrenceId, completionRecordId: record.id, amountCents })}::jsonb)
    `);
  });

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "completion_recorded", completionRecordId }),
    "notify-completion-recorded",
  );
  redirect(
    `${back(bookingId)}?notice=` +
      encodeURIComponent("Marked complete — the provider was asked to confirm the record."),
  );
}
