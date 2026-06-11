import { and, eq, inArray, sql } from "drizzle-orm";
import { serviceDb } from "@/db/service";
import {
  applications,
  bookings,
  completionRecords,
  opportunities,
  opportunityOccurrences,
  providerProfiles,
} from "@/db/schema";
import { dispatchNotification, type DispatchInput } from "@/lib/notifications/dispatch";
import type { NotifyEvent } from "@/lib/queue";

/**
 * Application/booking lifecycle events, enqueued by server actions and
 * processed here with the service role: each notification belongs to the
 * actor's COUNTERPARTY, whose rows the actor's RLS connection can't write.
 *
 * booking_confirmed additionally owns the cross-provider side effects that no
 * single user may perform: closing competing applications on filled dates and
 * flipping the opportunity to 'filled' when nothing open remains.
 *
 * Idempotent like the crons: every send dedups on (user, kind, eventKey), so
 * pg-boss retries after a partial failure never double-notify.
 */

const appUrl = () => process.env.APP_BASE_URL ?? "http://localhost:4000";

async function sendOnce(
  eventKey: string,
  input: Omit<DispatchInput, "payload"> & { payload?: Record<string, unknown> },
): Promise<void> {
  const existing = await serviceDb.execute<{ id: string }>(sql`
    select id from notifications
    where user_id = ${input.userId} and kind = ${input.kind}
      and payload ->> 'eventKey' = ${eventKey}
    limit 1
  `);
  if (existing.rows.length > 0) return;
  await dispatchNotification(serviceDb, {
    ...input,
    payload: { ...(input.payload ?? {}), eventKey },
  });
}

/** Application rows + the context every event needs to write copy. */
async function loadApplications(ids: string[]) {
  if (ids.length === 0) return [];
  return serviceDb
    .select({
      id: applications.id,
      status: applications.status,
      scope: applications.scope,
      occurrenceId: applications.occurrenceId,
      opportunityId: opportunities.id,
      title: opportunities.title,
      posterUserId: opportunities.postedByUserId,
      providerUserId: providerProfiles.userId,
      providerName: providerProfiles.displayName,
    })
    .from(applications)
    .innerJoin(opportunities, eq(opportunities.id, applications.opportunityId))
    .innerJoin(providerProfiles, eq(providerProfiles.id, applications.providerProfileId))
    .where(inArray(applications.id, ids));
}

async function loadBooking(bookingId: string) {
  const [row] = await serviceDb
    .select({
      id: bookings.id,
      scope: bookings.scope,
      status: bookings.status,
      opportunityId: opportunities.id,
      title: opportunities.title,
      posterUserId: opportunities.postedByUserId,
      opportunityStatus: opportunities.status,
      providerProfileId: bookings.providerProfileId,
      providerUserId: providerProfiles.userId,
      providerName: providerProfiles.displayName,
    })
    .from(bookings)
    .innerJoin(opportunities, eq(opportunities.id, bookings.opportunityId))
    .innerJoin(providerProfiles, eq(providerProfiles.id, bookings.providerProfileId))
    .where(eq(bookings.id, bookingId));
  return row ?? null;
}

const datesPhrase = (rows: { occurrenceId: string | null }[]) =>
  rows.some((r) => r.occurrenceId == null)
    ? "the whole series"
    : `${rows.length} date${rows.length === 1 ? "" : "s"}`;

export async function notifyEventJob(event: NotifyEvent): Promise<void> {
  switch (event.kind) {
    case "application_received": {
      const rows = await loadApplications(event.applicationIds);
      if (rows.length === 0) return;
      const first = rows[0];
      await sendOnce(`application_received:${first.id}`, {
        userId: first.posterUserId,
        category: "application_activity",
        kind: "application_received",
        title: `${first.providerName} applied to "${first.title}"`,
        body: `They applied for ${datesPhrase(rows)}. Review their credentials and portfolio, then make a selection.`,
        actionUrl: `${appUrl()}/b/opportunities/${first.opportunityId}/applicants`,
        requested: { email: true, sms: false },
      });
      return;
    }

    case "application_withdrawn": {
      const rows = await loadApplications(event.applicationIds);
      if (rows.length === 0) return;
      const first = rows[0];
      await sendOnce(`application_withdrawn:${first.id}`, {
        userId: first.posterUserId,
        category: "application_activity",
        kind: "application_withdrawn",
        title: `${first.providerName} withdrew from "${first.title}"`,
        body: "Their application is closed — other applicants are still available to review.",
        actionUrl: `${appUrl()}/b/opportunities/${first.opportunityId}/applicants`,
        requested: { email: true, sms: false },
      });
      return;
    }

    case "application_offered": {
      const rows = await loadApplications(event.applicationIds);
      if (rows.length === 0) return;
      const first = rows[0];
      await sendOnce(`application_offered:${first.id}`, {
        userId: first.providerUserId,
        category: "application_activity",
        kind: "application_offered",
        title: `You've been selected for "${first.title}"`,
        body: `The business selected you for ${datesPhrase(rows)}. Review the booking terms and confirm to lock it in.`,
        actionUrl: `${appUrl()}/p/applications`,
        requested: { email: true, sms: true },
      });
      return;
    }

    case "application_declined": {
      const rows = await loadApplications(event.applicationIds);
      if (rows.length === 0) return;
      const first = rows[0];
      if (event.by === "business") {
        await sendOnce(`application_declined:${first.id}`, {
          userId: first.providerUserId,
          category: "application_activity",
          kind: "application_declined",
          title: `Update on "${first.title}"`,
          body: "The business went another direction this time. Your watch zones are still active — the next match is on its way.",
          actionUrl: `${appUrl()}/p/applications`,
          requested: { email: true, sms: false },
        });
      } else {
        await sendOnce(`offer_declined:${first.id}`, {
          userId: first.posterUserId,
          category: "application_activity",
          kind: "offer_declined",
          title: `${first.providerName} declined your offer on "${first.title}"`,
          body: "No booking was created. Other applicants are still available to review.",
          actionUrl: `${appUrl()}/b/opportunities/${first.opportunityId}/applicants`,
          requested: { email: true, sms: false },
        });
      }
      return;
    }

    case "booking_confirmed": {
      const booking = await loadBooking(event.bookingId);
      if (!booking) return;
      await sendOnce(`booking_confirmed:${booking.id}`, {
        userId: booking.providerUserId,
        category: "booking_activity",
        kind: "booking_confirmed",
        title: `Booked: "${booking.title}"`,
        body: "Both sides confirmed — contact details are now visible on the booking page. See you there!",
        actionUrl: `${appUrl()}/p/bookings/${booking.id}`,
        requested: { email: true, sms: true },
      });
      await sendOnce(`booking_confirmed:${booking.id}`, {
        userId: booking.posterUserId,
        category: "booking_activity",
        kind: "booking_confirmed",
        title: `Booked: ${booking.providerName} for "${booking.title}"`,
        body: "Both sides confirmed — contact details are now visible on the booking page.",
        actionUrl: `${appUrl()}/b/bookings/${booking.id}`,
        requested: { email: true, sms: true },
      });
      await closeCompetingApplications(booking);
      return;
    }

    case "booking_canceled": {
      const booking = await loadBooking(event.bookingId);
      if (!booking) return;
      const what =
        event.occurrenceIds == null
          ? "The booking was canceled"
          : `${event.occurrenceIds.length} booked date${event.occurrenceIds.length === 1 ? " was" : "s were"} canceled`;
      const eventKey = `booking_canceled:${booking.id}:${event.occurrenceIds?.join(",") ?? "series"}`;
      if (event.by === "provider") {
        await sendOnce(eventKey, {
          userId: booking.posterUserId,
          category: "booking_activity",
          kind: "booking_canceled",
          title: `Cancellation on "${booking.title}"`,
          body: `${what} by ${booking.providerName}. Canceled future dates have reopened to other applicants.`,
          actionUrl: `${appUrl()}/b/bookings/${booking.id}`,
          requested: { email: true, sms: true },
        });
      } else {
        await sendOnce(eventKey, {
          userId: booking.providerUserId,
          category: "booking_activity",
          kind: "booking_canceled",
          title: `Cancellation on "${booking.title}"`,
          body: `${what} by the business. The reason is on the booking page.`,
          actionUrl: `${appUrl()}/p/bookings/${booking.id}`,
          requested: { email: true, sms: true },
        });
      }
      return;
    }

    case "no_show_reported": {
      const booking = await loadBooking(event.bookingId);
      if (!booking) return;
      const reported = event.absent === "provider" ? booking.providerUserId : booking.posterUserId;
      const url =
        event.absent === "provider"
          ? `${appUrl()}/p/bookings/${booking.id}`
          : `${appUrl()}/b/bookings/${booking.id}`;
      await sendOnce(`no_show_reported:${booking.id}:${event.occurrenceId}`, {
        userId: reported,
        category: "booking_activity",
        kind: "no_show_reported",
        title: `A no-show was reported on "${booking.title}"`,
        body: "If this doesn't match what happened, you can dispute it from the booking page and our team will take a look.",
        actionUrl: url,
        requested: { email: true, sms: false },
      });
      return;
    }

    case "no_show_disputed": {
      const booking = await loadBooking(event.bookingId);
      if (!booking) return;
      const [row] = await serviceDb.execute<{ reporter: string | null }>(sql`
        select no_show_reported_by_user_id as reporter
        from booking_occurrences
        where booking_id = ${event.bookingId} and occurrence_id = ${event.occurrenceId}
      `).then((r) => r.rows);
      if (!row?.reporter) return;
      await sendOnce(`no_show_disputed:${booking.id}:${event.occurrenceId}`, {
        userId: row.reporter,
        category: "booking_activity",
        kind: "no_show_disputed",
        title: `The no-show report on "${booking.title}" was disputed`,
        body: "The other side disagrees with the report. Our team will review it — nothing else is needed from you right now.",
        actionUrl: `${appUrl()}/b/bookings/${booking.id}`,
        requested: { email: true, sms: false },
      });
      return;
    }

    case "completion_recorded": {
      const [record] = await serviceDb
        .select({
          id: completionRecords.id,
          bookingId: completionRecords.bookingId,
        })
        .from(completionRecords)
        .where(eq(completionRecords.id, event.completionRecordId));
      if (!record) return;
      const booking = await loadBooking(record.bookingId);
      if (!booking) return;
      await sendOnce(`completion_recorded:${record.id}`, {
        userId: booking.providerUserId,
        category: "booking_activity",
        kind: "completion_recorded",
        title: `Completion recorded for "${booking.title}"`,
        body: "The business marked a date complete. Review the record — confirm it for your records, or dispute it if something's off.",
        actionUrl: `${appUrl()}/p/bookings/${booking.id}`,
        requested: { email: true, sms: false },
      });
      return;
    }

    case "completion_status": {
      const [record] = await serviceDb
        .select({
          id: completionRecords.id,
          bookingId: completionRecords.bookingId,
        })
        .from(completionRecords)
        .where(eq(completionRecords.id, event.completionRecordId));
      if (!record) return;
      const booking = await loadBooking(record.bookingId);
      if (!booking) return;
      await sendOnce(`completion_status:${record.id}:${event.status}`, {
        userId: booking.posterUserId,
        category: "booking_activity",
        kind: `completion_${event.status}`,
        title:
          event.status === "confirmed"
            ? `${booking.providerName} confirmed the completion record on "${booking.title}"`
            : `${booking.providerName} disputed the completion record on "${booking.title}"`,
        body:
          event.status === "confirmed"
            ? "Both sides now agree on the record — it's ready for your books."
            : "Check the record details on the booking page and talk it through; our team can help if you can't agree.",
        actionUrl: `${appUrl()}/b/bookings/${booking.id}`,
        requested: { email: true, sms: false },
      });
      return;
    }
  }
}

/**
 * After a booking confirms: close competing applications on dates that just
 * filled, and flip the opportunity to 'filled' when nothing open remains.
 * Other applicants are notified once per opportunity, not once per date.
 */
async function closeCompetingApplications(booking: {
  id: string;
  opportunityId: string;
  title: string;
  opportunityStatus: string;
  providerProfileId: string;
}): Promise<void> {
  // Occurrence-scoped applications pointing at a date that is now fully
  // booked (the trigger maintains occurrence status as bookings land).
  const occurrenceLosers = await serviceDb.execute<{ id: string; user_id: string }>(sql`
    update applications a
    set status = 'expired', status_changed_at = now()
    from opportunity_occurrences occ, provider_profiles pp
    where occ.id = a.occurrence_id
      and pp.id = a.provider_profile_id
      and a.opportunity_id = ${booking.opportunityId}
      and a.provider_profile_id <> ${booking.providerProfileId}
      and a.status in ('submitted', 'viewed', 'shortlisted', 'offered')
      and occ.status = 'booked'
    returning a.id, pp.user_id
  `);

  // Is anything still open to apply for? (future open occurrences — or, for
  // schedule-less types like part_time, the opportunity simply stays posted)
  const [{ has_occurrences, open_future }] = (
    await serviceDb.execute<{ has_occurrences: boolean; open_future: number }>(sql`
      select exists (select 1 from opportunity_occurrences where opportunity_id = ${booking.opportunityId}) as has_occurrences,
             (select count(*) from opportunity_occurrences
               where opportunity_id = ${booking.opportunityId}
                 and status = 'open' and starts_at > now())::int as open_future
    `)
  ).rows;

  let seriesLosers: { id: string; user_id: string }[] = [];
  if (has_occurrences && open_future === 0) {
    await serviceDb
      .update(opportunities)
      .set({ status: "filled", filledAt: new Date() })
      .where(and(eq(opportunities.id, booking.opportunityId), eq(opportunities.status, "posted")));
    seriesLosers = (
      await serviceDb.execute<{ id: string; user_id: string }>(sql`
        update applications a
        set status = 'expired', status_changed_at = now()
        from provider_profiles pp
        where pp.id = a.provider_profile_id
          and a.opportunity_id = ${booking.opportunityId}
          and a.provider_profile_id <> ${booking.providerProfileId}
          and a.status in ('submitted', 'viewed', 'shortlisted', 'offered')
        returning a.id, pp.user_id
      `)
    ).rows;
  }

  const losers = new Map<string, string>(); // userId -> one application id (for the dedup key)
  for (const row of [...occurrenceLosers.rows, ...seriesLosers]) {
    if (!losers.has(row.user_id)) losers.set(row.user_id, row.id);
  }
  for (const [userId, applicationId] of losers) {
    await sendOnce(`application_filled:${applicationId}`, {
      userId,
      category: "application_activity",
      kind: "application_filled",
      title: `"${booking.title}" was filled`,
      body: "The dates you applied for were booked by another provider. Your watch zones are still active — the next match is on its way.",
      actionUrl: `${appUrl()}/p/applications`,
      requested: { email: true, sms: false },
    });
  }
}
