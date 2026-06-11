import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  bookingOccurrences,
  bookings,
  completionRecords,
  locations,
  opportunities,
  opportunityOccurrences,
  organizations,
  providerProfiles,
} from "@/db/schema";

/** Everything one booking detail page needs, both sides. RLS scopes access —
 *  if the caller isn't a party (or their org isn't), the booking is null. */
export async function loadBookingDetail(tx: Tx, bookingId: string) {
  const [booking] = await tx
    .select({
      id: bookings.id,
      status: bookings.status,
      scope: bookings.scope,
      opportunityId: bookings.opportunityId,
      providerProfileId: bookings.providerProfileId,
      organizationId: bookings.organizationId,
      locationId: bookings.locationId,
      termsVersion: bookings.termsVersion,
      providerConfirmedAt: bookings.providerConfirmedAt,
      businessConfirmedAt: bookings.businessConfirmedAt,
      canceledAt: bookings.canceledAt,
      cancellationReason: bookings.cancellationReason,
      createdAt: bookings.createdAt,
      // Left joins: an expired/canceled post may be RLS-hidden from the
      // provider, but the booking page must keep working.
      title: opportunities.title,
      type: opportunities.type,
      timezone: opportunities.timezone,
      payKind: opportunities.payKind,
      payUnit: opportunities.payUnit,
      payMinCents: opportunities.payMinCents,
      payMaxCents: opportunities.payMaxCents,
      providerName: providerProfiles.displayName,
      providerUserId: providerProfiles.userId,
    })
    .from(bookings)
    .leftJoin(opportunities, eq(opportunities.id, bookings.opportunityId))
    .innerJoin(providerProfiles, eq(providerProfiles.id, bookings.providerProfileId))
    .where(eq(bookings.id, bookingId));
  if (!booking) return null;

  const [org] = await tx
    .select({ name: organizations.name, phone: organizations.phone })
    .from(organizations)
    .where(eq(organizations.id, booking.organizationId));
  const [location] = await tx
    .select({
      name: locations.name,
      addressLine1: locations.addressLine1,
      addressLine2: locations.addressLine2,
      city: locations.city,
      state: locations.state,
      zip: locations.zip,
      phone: locations.phone,
      parkingNotes: locations.parkingNotes,
      dressCode: locations.dressCode,
    })
    .from(locations)
    .where(eq(locations.id, booking.locationId));

  const dates = await tx
    .select({
      occurrenceId: bookingOccurrences.occurrenceId,
      status: bookingOccurrences.status,
      completedAt: bookingOccurrences.completedAt,
      canceledAt: bookingOccurrences.canceledAt,
      cancellationReason: bookingOccurrences.cancellationReason,
      noShowReportedByUserId: bookingOccurrences.noShowReportedByUserId,
      startsAt: opportunityOccurrences.startsAt,
      endsAt: opportunityOccurrences.endsAt,
    })
    .from(bookingOccurrences)
    .innerJoin(
      opportunityOccurrences,
      eq(opportunityOccurrences.id, bookingOccurrences.occurrenceId),
    )
    .where(eq(bookingOccurrences.bookingId, bookingId))
    .orderBy(asc(opportunityOccurrences.startsAt));

  const records = await tx
    .select()
    .from(completionRecords)
    .where(eq(completionRecords.bookingId, bookingId))
    .orderBy(asc(completionRecords.createdAt));

  // The counterparty's email, definer-gated to booking parties only.
  const emailResult = await tx.execute<{ email: string | null }>(
    sql`select public.booking_counterparty_email(${bookingId}::uuid) as email`,
  );

  return {
    booking,
    org: org ?? null,
    location: location ?? null,
    dates,
    records,
    counterpartyEmail: emailResult.rows[0]?.email ?? null,
  };
}

export const BOOKING_STATUS_LABELS: Record<string, { text: string; tone: string }> = {
  confirmed: { text: "Confirmed", tone: "bg-success/10 text-success" },
  completed: { text: "Completed", tone: "bg-success/10 text-success" },
  canceled_by_provider: { text: "Canceled by provider", tone: "bg-ink/5 text-ink-soft" },
  canceled_by_business: { text: "Canceled by business", tone: "bg-ink/5 text-ink-soft" },
  canceled_by_admin: { text: "Canceled by admin", tone: "bg-ink/5 text-ink-soft" },
  no_show_provider: { text: "Provider no-show reported", tone: "bg-danger/10 text-danger" },
  no_show_business: { text: "Business no-show reported", tone: "bg-danger/10 text-danger" },
  disputed: { text: "Disputed — under review", tone: "bg-danger/10 text-danger" },
};

export function formatCents(amountCents: number): string {
  return (amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
