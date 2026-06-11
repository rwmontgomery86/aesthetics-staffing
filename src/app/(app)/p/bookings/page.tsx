import Link from "next/link";
import { DateTime } from "luxon";
import { desc, eq, inArray } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  bookingOccurrences,
  bookings,
  opportunities,
  opportunityOccurrences,
  organizations,
} from "@/db/schema";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/queries";
import { requireProviderRow } from "@/lib/provider";

export const metadata = { title: "My bookings" };

export default async function ProviderBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { user, provider }] = await Promise.all([
    searchParams,
    requireProviderRow(),
  ]);

  const { rows, datesByBooking } = await dbAs(user, async (tx) => {
    const rows = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        createdAt: bookings.createdAt,
        title: opportunities.title,
        timezone: opportunities.timezone,
        orgName: organizations.name,
      })
      .from(bookings)
      .leftJoin(opportunities, eq(opportunities.id, bookings.opportunityId))
      .leftJoin(organizations, eq(organizations.id, bookings.organizationId))
      .where(eq(bookings.providerProfileId, provider.id))
      .orderBy(desc(bookings.createdAt));
    const ids = rows.map((row) => row.id);
    const dates = ids.length
      ? await tx
          .select({
            bookingId: bookingOccurrences.bookingId,
            status: bookingOccurrences.status,
            startsAt: opportunityOccurrences.startsAt,
          })
          .from(bookingOccurrences)
          .innerJoin(
            opportunityOccurrences,
            eq(opportunityOccurrences.id, bookingOccurrences.occurrenceId),
          )
          .where(inArray(bookingOccurrences.bookingId, ids))
      : [];
    const datesByBooking = new Map<string, typeof dates>();
    for (const date of dates) {
      const list = datesByBooking.get(date.bookingId) ?? [];
      list.push(date);
      datesByBooking.set(date.bookingId, list);
    }
    return { rows, datesByBooking };
  });

  const now = new Date();
  const cards = rows.map((row) => {
    const dates = datesByBooking.get(row.id) ?? [];
    const upcoming = dates
      .filter((d) => d.status === "confirmed" && d.startsAt > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const isCanceled = row.status.startsWith("canceled");
    const group: "upcoming" | "past" | "canceled" = isCanceled
      ? "canceled"
      : upcoming.length > 0 || (row.status === "confirmed" && dates.length === 0)
        ? "upcoming"
        : "past";
    return { ...row, group, nextDate: upcoming[0]?.startsAt ?? null, dateCount: dates.length };
  });

  const sections = [
    { key: "upcoming" as const, title: "Upcoming" },
    { key: "past" as const, title: "Past" },
    { key: "canceled" as const, title: "Canceled" },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">My bookings</h1>
      <p className="mt-2 text-ink-soft">
        Confirmed work, past and upcoming. Open a booking for contact details, date changes, and
        completion records.
      </p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      {cards.length === 0 ? (
        <div className="oc-card mt-8 p-6 text-center text-sm text-ink-soft">
          No bookings yet — when a business selects you and you confirm, the booking lands here.
        </div>
      ) : (
        sections.map((section) => {
          const sectionCards = cards.filter((card) => card.group === section.key);
          if (sectionCards.length === 0) return null;
          return (
            <section key={section.key} className="mt-8">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {sectionCards.map((card) => {
                  const badge = BOOKING_STATUS_LABELS[card.status] ?? BOOKING_STATUS_LABELS.confirmed;
                  return (
                    <Link
                      key={card.id}
                      href={`/p/bookings/${card.id}`}
                      className="oc-card block p-4 hover:border-lilac"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{card.title ?? "Booking"}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.tone}`}>
                          {badge.text}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">
                        {card.orgName ?? "—"}
                        {card.nextDate
                          ? ` · next: ${DateTime.fromJSDate(card.nextDate, {
                              zone: card.timezone ?? "America/New_York",
                            }).toFormat("EEE, MMM d · h:mm a")}`
                          : card.dateCount > 0
                            ? ` · ${card.dateCount} date${card.dateCount === 1 ? "" : "s"}`
                            : ""}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
