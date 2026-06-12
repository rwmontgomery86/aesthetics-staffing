import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { profiles, providerProfiles } from "@/db/schema";
import { BOOKING_STATUS_LABELS, formatCents, loadBookingDetail } from "@/lib/bookings/queries";
import { openBusinessThreadAction } from "@/app/(app)/b/messages/actions";
import { requireActiveOrg } from "@/lib/org";
import {
  cancelBookingAction,
  cancelBookingDateAction,
  completeOccurrenceAction,
  disputeNoShowAction,
  reportNoShowAction,
} from "../actions";

export const metadata = { title: "Booking" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BusinessBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ id }, { error, notice }, { contexts, org }] = await Promise.all([
    params,
    searchParams,
    requireActiveOrg(),
  ]);
  if (!UUID.test(id)) notFound();

  const data = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const detail = await loadBookingDetail(tx, id);
    if (!detail) return null;
    // Provider contact: the profiles row is RLS-visible to this org only
    // because a booking exists (the contact-reveal policy).
    const [contact] = await tx
      .select({ fullName: profiles.fullName, phone: profiles.phoneE164 })
      .from(profiles)
      .innerJoin(providerProfiles, eq(providerProfiles.userId, profiles.id))
      .where(eq(providerProfiles.id, detail.booking.providerProfileId));
    return { ...detail, contact: contact ?? null };
  });
  if (!data || data.booking.organizationId !== org.id) notFound();
  const { booking, location, dates, records, counterpartyEmail, contact } = data;

  const now = new Date();
  const tz = booking.timezone ?? "America/New_York";
  const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).toFormat("EEE, MMM d · h:mm a");
  const fmtTime = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).toFormat("h:mm a");
  const badge = BOOKING_STATUS_LABELS[booking.status] ?? BOOKING_STATUS_LABELS.confirmed;
  const recordsByOccurrence = new Map(records.map((r) => [r.occurrenceId, r]));
  const defaultRate = booking.payMinCents != null ? (booking.payMinCents / 100).toFixed(2) : "";

  return (
    <div className="max-w-2xl">
      <p className="text-sm">
        <Link href="/b/bookings" className="text-ink-soft hover:text-lilac">
          ← Bookings
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">{booking.title ?? "Booking"}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.tone}`}>
          {badge.text}
        </span>
      </div>
      <p className="mt-1 text-ink-soft">
        <Link href={`/b/providers/${booking.providerProfileId}`} className="hover:text-lilac">
          {booking.providerName}
        </Link>
        {location ? ` · ${location.name}` : ""}
      </p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      <section className="oc-card mt-6 p-6">
        <h2 className="text-lg font-semibold">Provider contact</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Unlocked when both sides confirmed. Document views stay logged.
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="inline text-ink-soft">Name: </dt>
            <dd className="inline">{contact?.fullName || booking.providerName}</dd>
          </div>
          {contact?.phone ? (
            <div>
              <dt className="inline text-ink-soft">Phone: </dt>
              <dd className="inline">{contact.phone}</dd>
            </div>
          ) : null}
          {counterpartyEmail ? (
            <div>
              <dt className="inline text-ink-soft">Email: </dt>
              <dd className="inline">
                <a href={`mailto:${counterpartyEmail}`} className="underline hover:text-lilac">
                  {counterpartyEmail}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
        <form action={openBusinessThreadAction} className="mt-4">
          <input type="hidden" name="opportunityId" value={booking.opportunityId} />
          <input type="hidden" name="providerProfileId" value={booking.providerProfileId} />
          <button type="submit" className="oc-btn-secondary">
            Message {booking.providerName}
          </button>
        </form>
      </section>

      {dates.length > 0 ? (
        <section className="oc-card mt-6 p-6">
          <h2 className="text-lg font-semibold">Dates</h2>
          <ul className="mt-3 space-y-4">
            {dates.map((date) => {
              const dateBadge = BOOKING_STATUS_LABELS[date.status] ?? BOOKING_STATUS_LABELS.confirmed;
              const record = recordsByOccurrence.get(date.occurrenceId);
              const isFuture = date.startsAt > now;
              const hasEnded = date.endsAt <= now;
              return (
                <li key={date.occurrenceId} className="border-b border-line pb-3 last:border-none last:pb-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">
                      {fmt(date.startsAt)} – {fmtTime(date.endsAt)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${dateBadge.tone}`}>
                      {dateBadge.text}
                    </span>
                  </div>
                  {date.cancellationReason ? (
                    <p className="mt-1 text-xs text-ink-soft">Note: {date.cancellationReason}</p>
                  ) : null}

                  {record ? (
                    <div className="mt-2 rounded-lg bg-ink/5 p-3 text-sm">
                      <p>
                        <span className="font-medium">Completion record:</span>{" "}
                        {formatCents(record.amountCents)}
                        {record.unitsWorked ? ` · ${record.unitsWorked} ${record.payUnit === "hour" ? "hrs" : "units"}` : ""}
                        {" · "}
                        {record.status === "pending" ? "awaiting provider confirmation" : record.status}
                      </p>
                      {record.notes ? <p className="mt-1 text-xs text-ink-soft">{record.notes}</p> : null}
                    </div>
                  ) : null}

                  {date.status === "confirmed" && hasEnded ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium text-success">
                        Mark complete
                      </summary>
                      <form action={completeOccurrenceAction} className="mt-2 space-y-2 text-sm">
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="occurrenceId" value={date.occurrenceId} />
                        <div className="flex flex-wrap gap-2">
                          <label className="flex items-center gap-1.5">
                            <span className="text-ink-soft">
                              {booking.payUnit === "hour"
                                ? "Hours"
                                : booking.payUnit === "per_treatment"
                                  ? "Treatments"
                                  : "Units"}
                            </span>
                            <input
                              name="unitsWorked"
                              type="number"
                              step="0.25"
                              min="0.25"
                              defaultValue={
                                booking.payUnit === "hour"
                                  ? (
                                      (date.endsAt.getTime() - date.startsAt.getTime()) /
                                      3600_000
                                    ).toFixed(2)
                                  : "1"
                              }
                              className="oc-input w-24"
                            />
                          </label>
                          <label className="flex items-center gap-1.5">
                            <span className="text-ink-soft">Rate ($)</span>
                            <input
                              name="rate"
                              type="number"
                              step="0.01"
                              min="0.01"
                              defaultValue={defaultRate}
                              required={!defaultRate}
                              className="oc-input w-28"
                            />
                          </label>
                        </div>
                        <input
                          name="notes"
                          placeholder="Notes for the record (optional)"
                          className="oc-input w-full"
                        />
                        <button type="submit" className="oc-btn-secondary">
                          Complete &amp; write record
                        </button>
                        <p className="text-xs text-ink-soft">
                          No payment is processed — this creates the invoice-ready record both
                          sides keep. You pay the provider directly.
                        </p>
                      </form>
                    </details>
                  ) : null}

                  {date.status === "confirmed" && hasEnded ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-ink-soft underline">
                        Provider didn&apos;t show?
                      </summary>
                      <form action={reportNoShowAction} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="occurrenceId" value={date.occurrenceId} />
                        <input
                          name="reason"
                          placeholder="What happened? (optional)"
                          className="oc-input flex-1 text-sm"
                        />
                        <button type="submit" className="oc-btn-secondary text-sm">
                          Report no-show
                        </button>
                      </form>
                    </details>
                  ) : null}

                  {date.status === "confirmed" && isFuture ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-ink-soft underline hover:text-danger">
                        Cancel this date
                      </summary>
                      <form action={cancelBookingDateAction} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="occurrenceId" value={date.occurrenceId} />
                        <input
                          name="reason"
                          required
                          placeholder="Reason (the provider sees this)"
                          className="oc-input flex-1 text-sm"
                        />
                        <button type="submit" className="oc-btn-secondary text-sm">
                          Cancel date
                        </button>
                      </form>
                    </details>
                  ) : null}

                  {date.status === "no_show_business" ? (
                    <form action={disputeNoShowAction} className="mt-2">
                      <input type="hidden" name="organizationId" value={org.id} />
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <input type="hidden" name="occurrenceId" value={date.occurrenceId} />
                      <button type="submit" className="text-sm underline hover:text-lilac">
                        This isn&apos;t right — dispute the report
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {booking.status === "confirmed" ? (
        <section className="oc-card mt-6 p-6">
          <h2 className="text-lg font-semibold text-danger">Cancel this booking</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Cancels every future date with {booking.providerName}. They&apos;re notified, and the
            dates reopen to other applicants.
          </p>
          <form action={cancelBookingAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="organizationId" value={org.id} />
            <input type="hidden" name="bookingId" value={booking.id} />
            <input
              name="reason"
              required
              placeholder="Reason (the provider sees this)"
              className="oc-input flex-1 text-sm"
            />
            <button type="submit" className="oc-btn-secondary text-danger">
              Cancel booking
            </button>
          </form>
        </section>
      ) : null}

      <p className="mt-6 text-xs text-ink-soft">
        Booked {DateTime.fromJSDate(booking.createdAt).toFormat("MMM d, yyyy")} under terms{" "}
        {booking.termsVersion}. Both sides accepted before this booking was created.
      </p>
    </div>
  );
}
