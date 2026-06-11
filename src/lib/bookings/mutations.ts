import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { bookingOccurrences, bookings, opportunityOccurrences } from "@/db/schema";
import { assertBookingTransition, type BookingStatus } from "@/lib/state/booking";

/**
 * Side-parameterized booking mutations, shared by the provider and business
 * action files (the flows are mirror images). Callers run these inside their
 * own dbAs() transaction — RLS has already established the caller is a party
 * to the booking, these helpers enforce the lifecycle rules on top.
 *
 * Occurrence reopening is NOT here: the sync trigger recounts confirmed
 * bookings and flips future occurrences back to 'open' whenever a
 * cancellation lands, because the provider side has no UPDATE right on
 * opportunity_occurrences.
 */

export type BookingSide = "provider" | "business";

export function cancelStatusFor(side: BookingSide): BookingStatus {
  return side === "provider" ? "canceled_by_provider" : "canceled_by_business";
}

export function noShowStatusForAbsent(absent: BookingSide): BookingStatus {
  return absent === "provider" ? "no_show_provider" : "no_show_business";
}

export async function loadBookingOccurrence(tx: Tx, bookingId: string, occurrenceId: string) {
  const [row] = await tx
    .select({
      bookingId: bookingOccurrences.bookingId,
      occurrenceId: bookingOccurrences.occurrenceId,
      status: bookingOccurrences.status,
      startsAt: opportunityOccurrences.startsAt,
      endsAt: opportunityOccurrences.endsAt,
      occurrenceStatus: opportunityOccurrences.status,
    })
    .from(bookingOccurrences)
    .innerJoin(
      opportunityOccurrences,
      eq(opportunityOccurrences.id, bookingOccurrences.occurrenceId),
    )
    .where(
      and(
        eq(bookingOccurrences.bookingId, bookingId),
        eq(bookingOccurrences.occurrenceId, occurrenceId),
      ),
    );
  return row ?? null;
}

/** Series cancel: the booking and every FUTURE confirmed date move together. */
export async function cancelSeries(
  tx: Tx,
  booking: { id: string; status: BookingStatus },
  side: BookingSide,
  userId: string,
  reason: string,
): Promise<void> {
  const to = cancelStatusFor(side);
  assertBookingTransition(booking.status, to);
  const now = new Date();
  await tx
    .update(bookings)
    .set({ status: to, canceledAt: now, canceledByUserId: userId, cancellationReason: reason })
    .where(eq(bookings.id, booking.id));
  // Past confirmed dates are history (they happened — completion and no-show
  // flows own them); only future dates cancel and reopen.
  await tx.execute(sql`
    update booking_occurrences bo
    set status = ${to}, canceled_at = ${now}, cancellation_reason = ${reason}
    from opportunity_occurrences occ
    where occ.id = bo.occurrence_id
      and bo.booking_id = ${booking.id}
      and bo.status = 'confirmed'
      and occ.starts_at > now()
  `);
}

export async function cancelDate(
  tx: Tx,
  bookingId: string,
  occurrence: { occurrenceId: string; status: BookingStatus },
  side: BookingSide,
  reason: string,
): Promise<void> {
  const to = cancelStatusFor(side);
  assertBookingTransition(occurrence.status, to);
  await tx
    .update(bookingOccurrences)
    .set({ status: to, canceledAt: new Date(), cancellationReason: reason })
    .where(
      and(
        eq(bookingOccurrences.bookingId, bookingId),
        eq(bookingOccurrences.occurrenceId, occurrence.occurrenceId),
      ),
    );
}

/** The REPORTER is `side`; the absent party is the other one. */
export async function reportNoShow(
  tx: Tx,
  bookingId: string,
  occurrence: { occurrenceId: string; status: BookingStatus },
  reporterSide: BookingSide,
  reporterUserId: string,
  notes: string,
): Promise<BookingSide> {
  const absent: BookingSide = reporterSide === "provider" ? "business" : "provider";
  const to = noShowStatusForAbsent(absent);
  assertBookingTransition(occurrence.status, to);
  await tx
    .update(bookingOccurrences)
    .set({
      status: to,
      noShowReportedByUserId: reporterUserId,
      // The generic per-row reason field; "cancellation" naming is historical.
      cancellationReason: notes || null,
    })
    .where(
      and(
        eq(bookingOccurrences.bookingId, bookingId),
        eq(bookingOccurrences.occurrenceId, occurrence.occurrenceId),
      ),
    );
  return absent;
}

/** Only the side the report is AGAINST may dispute it. */
export async function disputeNoShow(
  tx: Tx,
  bookingId: string,
  occurrence: { occurrenceId: string; status: BookingStatus },
  disputerSide: BookingSide,
): Promise<boolean> {
  const expected = noShowStatusForAbsent(disputerSide);
  if (occurrence.status !== expected) return false;
  assertBookingTransition(occurrence.status, "disputed");
  await tx
    .update(bookingOccurrences)
    .set({ status: "disputed" })
    .where(
      and(
        eq(bookingOccurrences.bookingId, bookingId),
        eq(bookingOccurrences.occurrenceId, occurrence.occurrenceId),
      ),
    );
  return true;
}
