import { DateTime } from "luxon";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { serviceDb } from "@/db/service";
import {
  credentialTypes,
  opportunities,
  opportunityOccurrences,
  providerCredentials,
  providerProfiles,
} from "@/db/schema";
import { MATERIALIZE_WEEKS, expandWeekly } from "@/lib/recurrence";
import { dispatchNotification } from "@/lib/notifications/dispatch";

/**
 * Cron job bodies. Every one is idempotent and safely re-runnable: occurrence
 * inserts ride the unique index, expirations are status-guarded, and
 * notification-producing scans dedup against existing notification rows.
 */

const appUrl = () => process.env.APP_BASE_URL ?? "http://localhost:4000";

/** Extend every live recurring series to the rolling 8-week horizon. NEVER alerts. */
export async function generateOccurrencesJob(): Promise<void> {
  const series = await serviceDb
    .select()
    .from(opportunities)
    .where(and(isNotNull(opportunities.recurrenceRule), inArray(opportunities.status, ["draft", "posted"])));

  const now = new Date();
  const windowEnd = new Date(now.getTime() + MATERIALIZE_WEEKS * 7 * 24 * 3600_000);
  let inserted = 0;

  for (const opp of series) {
    if (!opp.recurrenceRule || !opp.recurrenceLocalStart || opp.recurrenceDurationMin == null) continue;
    const occurrences = expandWeekly({
      rrule: opp.recurrenceRule,
      localStart: opp.recurrenceLocalStart.slice(0, 5),
      durationMin: opp.recurrenceDurationMin,
      timezone: opp.timezone,
      seriesStart: DateTime.fromJSDate(now, { zone: opp.timezone }).toFormat("yyyy-MM-dd"),
      windowStart: now,
      windowEnd,
    });
    if (occurrences.length === 0) continue;
    const result = await serviceDb
      .insert(opportunityOccurrences)
      .values(occurrences.map((o) => ({ opportunityId: opp.id, startsAt: o.startsAt, endsAt: o.endsAt })))
      .onConflictDoNothing()
      .returning({ id: opportunityOccurrences.id });
    inserted += result.length;
  }
  console.log(`[generate-occurrences] ${series.length} series, ${inserted} new occurrences`);
}

/**
 * posted → expired when past expires_at / application_deadline, or when a
 * scheduled opportunity has no future open/booked dates left. The SQL is
 * status-guarded to exactly the posted→expired transition the state machine
 * allows. Stale submitted applications close with their opportunity (B.11).
 */
export async function expireOpportunitiesJob(): Promise<void> {
  const expired = await serviceDb.execute<{ id: string }>(sql`
    update opportunities o
    set status = 'expired'
    where o.status = 'posted'
      and (
        (o.expires_at is not null and o.expires_at < now())
        or (o.application_deadline is not null and o.application_deadline < now())
        or (
          o.type in ('one_time_shift', 'recurring_shift', 'popup_event', 'training_event')
          and exists (select 1 from opportunity_occurrences oc where oc.opportunity_id = o.id)
          and not exists (
            select 1 from opportunity_occurrences oc
            where oc.opportunity_id = o.id
              and oc.status in ('open', 'booked')
              and oc.ends_at > now()
          )
        )
      )
    returning o.id
  `);

  const closedApplications = await serviceDb.execute<{ id: string }>(sql`
    update applications a
    set status = 'expired', status_changed_at = now()
    from opportunities o
    where o.id = a.opportunity_id
      and a.status = 'submitted'
      and o.status in ('expired', 'canceled', 'filled')
    returning a.id
  `);

  if (expired.rows.length || closedApplications.rows.length) {
    console.log(
      `[expire-opportunities] expired ${expired.rows.length} opportunities, closed ${closedApplications.rows.length} stale applications`,
    );
  }
}

/** 30-day / 7-day / expired credential notices, deduped per credential+window. */
export async function credentialExpiryScanJob(): Promise<void> {
  const today = DateTime.now().setZone("America/New_York").startOf("day");
  const horizon = today.plus({ days: 30 }).toFormat("yyyy-MM-dd");

  const rows = await serviceDb
    .select({
      credentialId: providerCredentials.id,
      expiresAt: providerCredentials.expiresAt,
      userId: providerProfiles.userId,
      typeName: credentialTypes.name,
    })
    .from(providerCredentials)
    .innerJoin(providerProfiles, eq(providerProfiles.id, providerCredentials.providerProfileId))
    .innerJoin(credentialTypes, eq(credentialTypes.id, providerCredentials.credentialTypeId))
    .where(and(isNotNull(providerCredentials.expiresAt), sql`${providerCredentials.expiresAt} <= ${horizon}`));

  let sent = 0;
  for (const row of rows) {
    const daysLeft = Math.ceil(DateTime.fromISO(row.expiresAt!).diff(today, "days").days);
    const window = daysLeft <= 0 ? "expired" : daysLeft <= 7 ? "7d" : "30d";
    const kind = `credential_expiring_${window}`;

    const existing = await serviceDb.execute<{ id: string }>(sql`
      select id from notifications
      where user_id = ${row.userId} and kind = ${kind}
        and payload ->> 'credentialId' = ${row.credentialId}
      limit 1
    `);
    if (existing.rows.length > 0) continue;

    await dispatchNotification(serviceDb, {
      userId: row.userId,
      category: "credentials",
      kind,
      title:
        window === "expired"
          ? `Your ${row.typeName} has expired`
          : `Your ${row.typeName} expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      body:
        window === "expired"
          ? "Businesses see expired credentials flagged on your applications. Update it to keep your profile strong — you'll still get alerts either way."
          : "Renew it before it lapses — businesses see credential status on every application.",
      actionUrl: `${appUrl()}/p/credentials`,
      payload: { credentialId: row.credentialId, window },
      requested: { email: true, sms: false },
    });
    sent += 1;
  }
  if (rows.length) console.log(`[credential-expiry-scan] ${rows.length} expiring, ${sent} new notices`);
}

/**
 * Booking reminders at ~24h and ~1h before a confirmed date. Runs every
 * 15 minutes; windows are ±15 min so nothing is missed or doubled (the
 * notification dedup is the real guard). No bookings exist until Phase 7 —
 * this is live wiring awaiting data.
 */
export async function bookingRemindersJob(): Promise<void> {
  const windows = [
    { label: "24h", fromMin: 24 * 60 - 15, toMin: 24 * 60 + 15, sms: false },
    { label: "1h", fromMin: 45, toMin: 75, sms: true },
  ];
  for (const window of windows) {
    const rows = await serviceDb.execute<{
      booking_occurrence: string;
      starts_at: Date;
      provider_user_id: string;
      poster_user_id: string;
      title: string;
      opportunity_id: string;
    }>(sql`
      select bo.occurrence_id as booking_occurrence,
             occ.starts_at,
             pp.user_id as provider_user_id,
             o.posted_by_user_id as poster_user_id,
             o.title,
             o.id as opportunity_id
      from booking_occurrences bo
      join bookings b on b.id = bo.booking_id
      join opportunity_occurrences occ on occ.id = bo.occurrence_id
      join opportunities o on o.id = b.opportunity_id
      join provider_profiles pp on pp.id = b.provider_profile_id
      where bo.status = 'confirmed' and b.status = 'confirmed'
        and occ.starts_at between now() + make_interval(mins => ${window.fromMin})
                              and now() + make_interval(mins => ${window.toMin})
    `);

    for (const row of rows.rows) {
      for (const userId of [row.provider_user_id, row.poster_user_id]) {
        const kind = `booking_reminder_${window.label}`;
        const existing = await serviceDb.execute<{ id: string }>(sql`
          select id from notifications
          where user_id = ${userId} and kind = ${kind}
            and payload ->> 'bookingOccurrence' = ${row.booking_occurrence}
          limit 1
        `);
        if (existing.rows.length > 0) continue;
        await dispatchNotification(serviceDb, {
          userId,
          category: "reminders",
          kind,
          title: `Reminder: ${row.title} ${window.label === "1h" ? "starts in about an hour" : "is tomorrow"}`,
          body: `Booked date starting ${row.starts_at.toISOString()}.`,
          actionUrl: `${appUrl()}/o/${row.opportunity_id}`,
          payload: { bookingOccurrence: row.booking_occurrence, window: window.label },
          requested: { email: true, sms: window.sms },
        });
      }
    }
  }
}

/** Nudge posters about applications sitting unreviewed for 48h. Phase 7 data. */
export async function applicationStaleNudgeJob(): Promise<void> {
  const rows = await serviceDb.execute<{
    application_id: string;
    poster_user_id: string;
    title: string;
    opportunity_id: string;
    waiting: number;
  }>(sql`
    select a.id as application_id,
           o.posted_by_user_id as poster_user_id,
           o.title,
           o.id as opportunity_id,
           count(*) over (partition by o.id) as waiting
    from applications a
    join opportunities o on o.id = a.opportunity_id
    where a.status = 'submitted'
      and a.created_at < now() - interval '48 hours'
      and o.status = 'posted'
  `);

  const seenOpportunities = new Set<string>();
  for (const row of rows.rows) {
    if (seenOpportunities.has(row.opportunity_id)) continue;
    seenOpportunities.add(row.opportunity_id);
    const existing = await serviceDb.execute<{ id: string }>(sql`
      select id from notifications
      where user_id = ${row.poster_user_id} and kind = 'application_stale_nudge'
        and payload ->> 'applicationId' = ${row.application_id}
      limit 1
    `);
    if (existing.rows.length > 0) continue;
    await dispatchNotification(serviceDb, {
      userId: row.poster_user_id,
      category: "application_activity",
      kind: "application_stale_nudge",
      title: `${row.waiting} application${Number(row.waiting) === 1 ? "" : "s"} waiting on "${row.title}"`,
      body: "Providers move fast — a quick review keeps your applicants from booking elsewhere.",
      actionUrl: `${appUrl()}/b/opportunities/${row.opportunity_id}`,
      payload: { applicationId: row.application_id },
      requested: { email: true, sms: false },
    });
  }
}
