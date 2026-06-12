import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { dbAs } from "@/db/client";
import { BOOKING_STATUS_LABELS, formatCents, loadBookingDetail } from "@/lib/bookings/queries";
import { openProviderThreadAction } from "@/app/(app)/p/messages/actions";
import { requireProviderRow } from "@/lib/provider";
import {
  cancelBookingAction,
  cancelBookingDateAction,
  disputeNoShowAction,
  reportNoShowAction,
  reviewCompletionAction,
} from "../actions";

export const metadata = { title: "Booking" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProviderBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ id }, { error, notice }, { user, provider }] = await Promise.all([
    params,
    searchParams,
    requireProviderRow(),
  ]);
  if (!UUID.test(id)) notFound();

  const data = await dbAs(user, async (tx) => loadBookingDetail(tx, id));
  if (!data || data.booking.providerProfileId !== provider.id) notFound();
  const { booking, org, location, dates, records, counterpartyEmail } = data;

  const now = new Date();
  const tz = booking.timezone ?? "America/New_York";
  const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).toFormat("EEE, MMM d · h:mm a");
  const fmtTime = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).toFormat("h:mm a");
  const badge = BOOKING_STATUS_LABELS[booking.status] ?? BOOKING_STATUS_LABELS.confirmed;
  const recordsByOccurrence = new Map(records.map((r) => [r.occurrenceId, r]));

  return (
    <div className="max-w-2xl">
      <p className="text-sm">
        <Link href="/p/bookings" className="text-ink-soft hover:text-lilac">
          ← My bookings
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">{booking.title ?? "Booking"}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.tone}`}>
          {badge.text}
        </span>
      </div>
      <p className="mt-1 text-ink-soft">{org?.name}</p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      <section className="oc-card mt-6 p-6">
        <h2 className="text-lg font-semibold">Where &amp; who</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Contact details unlocked when both sides confirmed.
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          {location ? (
            <div>
              <dt className="inline text-ink-soft">Location: </dt>
              <dd className="inline">
                {location.name} — {location.addressLine1}
                {location.addressLine2 ? `, ${location.addressLine2}` : ""}, {location.city},{" "}
                {location.state} {location.zip}
              </dd>
            </div>
          ) : null}
          {location?.phone || org?.phone ? (
            <div>
              <dt className="inline text-ink-soft">Phone: </dt>
              <dd className="inline">{location?.phone ?? org?.phone}</dd>
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
          {location?.parkingNotes ? (
            <div>
              <dt className="inline text-ink-soft">Parking: </dt>
              <dd className="inline">{location.parkingNotes}</dd>
            </div>
          ) : null}
          {location?.dressCode ? (
            <div>
              <dt className="inline text-ink-soft">Dress code: </dt>
              <dd className="inline">{location.dressCode}</dd>
            </div>
          ) : null}
        </dl>
        <form action={openProviderThreadAction} className="mt-4">
          <input type="hidden" name="opportunityId" value={booking.opportunityId} />
          <button type="submit" className="oc-btn-secondary">
            Message the business
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
                        {record.status === "pending"
                          ? "awaiting your confirmation"
                          : record.status}
                      </p>
                      {record.notes ? <p className="mt-1 text-xs text-ink-soft">{record.notes}</p> : null}
                      {record.status === "pending" ? (
                        <div className="mt-2 flex gap-3">
                          <form action={reviewCompletionAction}>
                            <input type="hidden" name="bookingId" value={booking.id} />
                            <input type="hidden" name="completionRecordId" value={record.id} />
                            <input type="hidden" name="decision" value="confirmed" />
                            <button type="submit" className="oc-btn-secondary text-sm">
                              Looks right — confirm
                            </button>
                          </form>
                          <form action={reviewCompletionAction}>
                            <input type="hidden" name="bookingId" value={booking.id} />
                            <input type="hidden" name="completionRecordId" value={record.id} />
                            <input type="hidden" name="decision" value="disputed" />
                            <button type="submit" className="text-sm text-ink-soft underline hover:text-danger">
                              Dispute
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {date.status === "confirmed" && isFuture ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-ink-soft underline hover:text-danger">
                        Cancel this date
                      </summary>
                      <form action={cancelBookingDateAction} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="occurrenceId" value={date.occurrenceId} />
                        <input
                          name="reason"
                          required
                          placeholder="Reason (the business sees this)"
                          className="oc-input flex-1 text-sm"
                        />
                        <button type="submit" className="oc-btn-secondary text-sm">
                          Cancel date
                        </button>
                      </form>
                    </details>
                  ) : null}

                  {date.status === "confirmed" && hasEnded ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-ink-soft underline">
                        The business didn&apos;t honor this date?
                      </summary>
                      <form action={reportNoShowAction} className="mt-2 flex flex-wrap gap-2">
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

                  {date.status === "no_show_provider" ? (
                    <form action={disputeNoShowAction} className="mt-2">
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
            Cancels every future date. The business is notified, and the dates reopen to other
            providers. Frequent late cancellations hurt your standing.
          </p>
          <form action={cancelBookingAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="bookingId" value={booking.id} />
            <input
              name="reason"
              required
              placeholder="Reason (the business sees this)"
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
