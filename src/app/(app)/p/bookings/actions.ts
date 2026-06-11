"use server";

import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { dbAs, type Tx } from "@/db/client";
import { bookings, completionRecords } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import {
  cancelDate,
  cancelSeries,
  disputeNoShow,
  loadBookingOccurrence,
  reportNoShow,
} from "@/lib/bookings/mutations";
import { providerInTx } from "@/lib/provider";
import { enqueueNotifyEvent, tryEnqueue, type NotifyEvent } from "@/lib/queue";

function back(bookingId: string): string {
  return `/p/bookings/${bookingId}`;
}

function fail(backTo: string, message: string): never {
  redirect(`${backTo}?error=${encodeURIComponent(message)}`);
}

const bookingSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().trim().max(1000).default(""),
});

const dateSchema = bookingSchema.extend({ occurrenceId: z.string().uuid() });

/** Booking pinned to the signed-in provider (RLS plus an explicit app check). */
async function myBooking(tx: Tx, userId: string, bookingId: string) {
  const provider = await providerInTx(tx, userId);
  const [booking] = await tx
    .select({
      id: bookings.id,
      status: bookings.status,
      organizationId: bookings.organizationId,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.providerProfileId, provider.id)));
  if (!booking) redirect("/p/bookings");
  return booking;
}

export async function cancelBookingAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = bookingSchema.safeParse({
    bookingId: formData.get("bookingId"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) redirect("/p/bookings");
  const { bookingId, reason } = parsed.data;
  if (!reason) fail(back(bookingId), "Add a short reason — the business sees it.");

  await dbAs(user, async (tx) => {
    const booking = await myBooking(tx, user.id, bookingId);
    if (booking.status !== "confirmed") fail(back(bookingId), "This booking is already closed.");
    await cancelSeries(tx, booking, "provider", user.id, reason);
    await tx.execute(sql`
      select public.record_audit('provider', 'booking.canceled', 'booking',
        ${bookingId}::uuid, ${booking.organizationId}::uuid,
        ${JSON.stringify({ scope: "series", reason })}::jsonb)
    `);
  });
  await tryEnqueue(
    () =>
      enqueueNotifyEvent({ kind: "booking_canceled", bookingId, occurrenceIds: null, by: "provider" }),
    "notify-booking-canceled",
  );
  redirect(`${back(bookingId)}?notice=` + encodeURIComponent("Booking canceled."));
}

export async function cancelBookingDateAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = dateSchema.safeParse({
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) redirect("/p/bookings");
  const { bookingId, occurrenceId, reason } = parsed.data;
  if (!reason) fail(back(bookingId), "Add a short reason — the business sees it.");

  await dbAs(user, async (tx) => {
    const booking = await myBooking(tx, user.id, bookingId);
    const occurrence = await loadBookingOccurrence(tx, bookingId, occurrenceId);
    if (!occurrence || occurrence.status !== "confirmed") {
      fail(back(bookingId), "That date isn't an active booking anymore.");
    }
    if (occurrence.startsAt <= new Date()) {
      fail(back(bookingId), "Past dates can't be canceled — use the no-show report if something went wrong.");
    }
    await cancelDate(tx, bookingId, occurrence, "provider", reason);
    await tx.execute(sql`
      select public.record_audit('provider', 'booking.date_canceled', 'booking',
        ${bookingId}::uuid, ${booking.organizationId}::uuid,
        ${JSON.stringify({ occurrenceId, reason })}::jsonb)
    `);
  });
  await tryEnqueue(
    () =>
      enqueueNotifyEvent({
        kind: "booking_canceled",
        bookingId,
        occurrenceIds: [occurrenceId],
        by: "provider",
      }),
    "notify-booking-date-canceled",
  );
  redirect(`${back(bookingId)}?notice=` + encodeURIComponent("Date canceled."));
}

/** The provider reporting that the BUSINESS didn't honor the booked date. */
export async function reportNoShowAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = dateSchema.safeParse({
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) redirect("/p/bookings");
  const { bookingId, occurrenceId, reason } = parsed.data;

  let event: NotifyEvent | null = null;
  await dbAs(user, async (tx) => {
    const booking = await myBooking(tx, user.id, bookingId);
    const occurrence = await loadBookingOccurrence(tx, bookingId, occurrenceId);
    if (!occurrence || occurrence.status !== "confirmed") {
      fail(back(bookingId), "Only active booked dates can be reported.");
    }
    if (occurrence.endsAt > new Date()) {
      fail(back(bookingId), "You can report a no-show once the date has passed.");
    }
    const absent = await reportNoShow(tx, bookingId, occurrence, "provider", user.id, reason);
    event = { kind: "no_show_reported", bookingId, occurrenceId, absent };
    await tx.execute(sql`
      select public.record_audit('provider', 'booking.no_show_reported', 'booking',
        ${bookingId}::uuid, ${booking.organizationId}::uuid,
        ${JSON.stringify({ occurrenceId, absent })}::jsonb)
    `);
  });
  if (event) await tryEnqueue(() => enqueueNotifyEvent(event!), "notify-no-show");
  redirect(
    `${back(bookingId)}?notice=` +
      encodeURIComponent("No-show recorded. Our team can step in if it's contested."),
  );
}

/** Disputing a no-show report that was filed AGAINST the provider. */
export async function disputeNoShowAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = dateSchema.safeParse({
    bookingId: formData.get("bookingId"),
    occurrenceId: formData.get("occurrenceId"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) redirect("/p/bookings");
  const { bookingId, occurrenceId } = parsed.data;

  await dbAs(user, async (tx) => {
    const booking = await myBooking(tx, user.id, bookingId);
    const occurrence = await loadBookingOccurrence(tx, bookingId, occurrenceId);
    if (!occurrence || !(await disputeNoShow(tx, bookingId, occurrence, "provider"))) {
      fail(back(bookingId), "There's no report against you to dispute on that date.");
    }
    await tx.execute(sql`
      select public.record_audit('provider', 'booking.no_show_disputed', 'booking',
        ${bookingId}::uuid, ${booking.organizationId}::uuid,
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

const completionSchema = z.object({
  bookingId: z.string().uuid(),
  completionRecordId: z.string().uuid(),
  decision: z.enum(["confirmed", "disputed"]),
});

/** Provider's sign-off (or dispute) on a completion record the business wrote. */
export async function reviewCompletionAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = completionSchema.safeParse({
    bookingId: formData.get("bookingId"),
    completionRecordId: formData.get("completionRecordId"),
    decision: formData.get("decision"),
  });
  if (!parsed.success) redirect("/p/bookings");
  const { bookingId, completionRecordId, decision } = parsed.data;

  await dbAs(user, async (tx) => {
    await myBooking(tx, user.id, bookingId);
    const [record] = await tx
      .select({ id: completionRecords.id, status: completionRecords.status })
      .from(completionRecords)
      .where(
        and(eq(completionRecords.id, completionRecordId), eq(completionRecords.bookingId, bookingId)),
      );
    if (!record || record.status !== "pending") {
      fail(back(bookingId), "That completion record was already settled.");
    }
    await tx
      .update(completionRecords)
      .set(
        decision === "confirmed"
          ? { status: "confirmed", confirmedByUserId: user.id, confirmedAt: new Date() }
          : { status: "disputed" },
      )
      .where(eq(completionRecords.id, completionRecordId));
  });
  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "completion_status", completionRecordId, status: decision }),
    "notify-completion-status",
  );
  redirect(
    `${back(bookingId)}?notice=` +
      encodeURIComponent(decision === "confirmed" ? "Completion confirmed." : "Dispute recorded."),
  );
}
