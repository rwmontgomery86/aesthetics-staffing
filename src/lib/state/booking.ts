/**
 * Booking status machine — applies to BOTH levels: bookings (series) and
 * booking_occurrences (per-date). A booking row only exists once both sides
 * have confirmed, so 'confirmed' is the entry state by construction.
 *
 * No-show contests move to 'disputed'; resolution ('disputed' → completed or
 * canceled_by_admin) is the Phase 9 admin's move. Completion disagreements
 * live on completion_records.status, not here.
 */
export type BookingStatus =
  | "confirmed"
  | "completed"
  | "canceled_by_provider"
  | "canceled_by_business"
  | "canceled_by_admin"
  | "no_show_provider"
  | "no_show_business"
  | "disputed";

const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  confirmed: [
    "completed",
    "canceled_by_provider",
    "canceled_by_business",
    "canceled_by_admin",
    "no_show_provider",
    "no_show_business",
  ],
  completed: [],
  canceled_by_provider: [],
  canceled_by_business: [],
  canceled_by_admin: [],
  no_show_provider: ["disputed", "canceled_by_admin"],
  no_show_business: ["disputed", "canceled_by_admin"],
  disputed: ["completed", "canceled_by_admin"],
};

export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!BOOKING_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid booking status transition: ${from} → ${to}`);
  }
}

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}
