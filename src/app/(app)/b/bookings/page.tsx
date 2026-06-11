import Link from "next/link";
import { DateTime } from "luxon";
import { desc, eq, inArray } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  bookingOccurrences,
  bookings,
  opportunities,
  opportunityOccurrences,
  providerProfiles,
} from "@/db/schema";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/queries";
import { requireActiveOrg } from "@/lib/org";

export const metadata = { title: "Bookings" };

export default async function BusinessBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { contexts, org }] = await Promise.all([
    searchParams,
    requireActiveOrg(),
  ]);

  const { rows, datesByBooking } = await dbAs(
    { id: contexts.user.id, email: contexts.user.email },
    async (tx) => {
      const rows = await tx
        .select({
          id: bookings.id,
          status: bookings.status,
          createdAt: bookings.createdAt,
          title: opportunities.title,
          timezone: opportunities.timezone,
          providerName: providerProfiles.displayName,
        })
        .from(bookings)
        .leftJoin(opportunities, eq(opportunities.id, bookings.opportunityId))
        .innerJoin(providerProfiles, eq(providerProfiles.id, bookings.providerProfileId))
        .where(eq(bookings.organizationId, org.id))
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
    },
  );

  const now = new Date();
  const cards = rows.map((row) => {
    const dates = datesByBooking.get(row.id) ?? [];
    const upcoming = dates
      .filter((d) => d.status === "confirmed" && d.startsAt > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const needsCompletion = dates.some((d) => d.status === "confirmed" && d.startsAt <= now);
    const isCanceled = row.status.startsWith("canceled");
    const group: "upcoming" | "past" | "canceled" = isCanceled
      ? "canceled"
      : upcoming.length > 0 || (row.status === "confirmed" && dates.length === 0)
        ? "upcoming"
        : "past";
    return {
      ...row,
      group,
      needsCompletion,
      nextDate: upcoming[0]?.startsAt ?? null,
      dateCount: dates.length,
    };
  });

  const sections = [
    { key: "upcoming" as const, title: "Upcoming" },
    { key: "past" as const, title: "Past" },
    { key: "canceled" as const, title: "Canceled" },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Bookings</h1>
      <p className="mt-2 text-ink-soft">
        Confirmed providers across all your posts. Open a booking for contact details, date
        changes, and completion records.
      </p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      {cards.length === 0 ? (
        <div className="oc-card mt-8 p-6 text-center text-sm text-ink-soft">
          No bookings yet — select an applicant on one of your opportunities and the booking lands
          here once they confirm.
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
                      href={`/b/bookings/${card.id}`}
                      className="oc-card block p-4 hover:border-lilac"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {card.providerName} — {card.title ?? "Booking"}
                        </span>
                        <span className="flex gap-2">
                          {card.needsCompletion ? (
                            <span className="rounded-full bg-blush/30 px-2.5 py-0.5 text-xs font-medium text-blush-deep">
                              dates to complete
                            </span>
                          ) : null}
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.tone}`}
                          >
                            {badge.text}
                          </span>
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink-soft">
                        {card.nextDate
                          ? `Next: ${DateTime.fromJSDate(card.nextDate, {
                              zone: card.timezone ?? "America/New_York",
                            }).toFormat("EEE, MMM d · h:mm a")}`
                          : card.dateCount > 0
                            ? `${card.dateCount} date${card.dateCount === 1 ? "" : "s"}`
                            : "No dated schedule"}
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
