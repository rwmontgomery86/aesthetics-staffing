import "server-only";
import { DateTime } from "luxon";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  notificationDeliveries,
  notificationPreferences,
  notifications,
  profiles,
} from "@/db/schema";
import { enqueueDeliverEmail, enqueueDeliverSms, tryEnqueue } from "@/lib/queue";
import { formatPay } from "@/lib/opportunity-types";
import type { OpportunityContext } from "@/lib/matching/engine";
import type { Grade } from "@/lib/matching/score";

/**
 * Notification dispatcher: ONE notifications row per event (the in-app
 * surface and audit record), plus a notification_deliveries row per external
 * channel, sent through the deliver-email/deliver-sms queues with retries.
 *
 * Takes the database as a parameter instead of importing the service client:
 * this module sits outside the ESLint service-role fence on purpose — only
 * fenced callers (fanout, worker jobs, webhooks) can hand it a connection.
 */

export type Db = NodePgDatabase<typeof schema>;

type Category =
  | "watch_match"
  | "application_activity"
  | "booking_activity"
  | "messages"
  | "credentials"
  | "reminders"
  | "admin"
  | "marketing";

export interface DispatchInput {
  userId: string;
  category: Category;
  kind: string;
  title: string;
  body: string;
  actionUrl?: string | null;
  payload?: Record<string, unknown>;
  /** Channels the SOURCE wants (e.g. the matched zone's toggles). */
  requested: { email: boolean; sms: boolean };
  /** Urgent-SMS override: bypasses zone/category SMS toggles, never user opt-in. */
  forceSms?: boolean;
}

/** Bounced recipients are suppressed from future sends (compliance). */
async function isSuppressed(db: Db, recipient: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(eq(notificationDeliveries.recipient, recipient), eq(notificationDeliveries.status, "bounced")),
    )
    .limit(1);
  return Boolean(row);
}

export async function dispatchNotification(db: Db, input: DispatchInput): Promise<string> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, input.userId));
  const emailResult = await db.execute<{ email: string | null }>(
    sql`select email from auth.users where id = ${input.userId}`,
  );
  const email = emailResult.rows[0]?.email ?? null;
  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, input.userId),
        eq(notificationPreferences.category, input.category),
      ),
    );
  // Absent row = table defaults: in-app + email on, SMS off.
  const categoryEmail = prefs?.email ?? true;
  const categorySms = prefs?.sms ?? false;

  const [notification] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      payload: input.payload ?? {},
      actionUrl: input.actionUrl ?? null,
    })
    .returning({ id: notifications.id });

  const wantEmail =
    input.requested.email &&
    categoryEmail &&
    (profile?.emailOptedIn ?? false) &&
    email != null &&
    !(await isSuppressed(db, email));

  const smsUserOk =
    (profile?.smsOptedIn ?? false) &&
    profile?.smsOptOutAt == null &&
    profile?.phoneVerifiedAt != null &&
    profile?.phoneE164 != null;
  const wantSms = smsUserOk && (input.forceSms || (input.requested.sms && categorySms));

  if (wantEmail && email) {
    const [delivery] = await db
      .insert(notificationDeliveries)
      .values({ notificationId: notification.id, channel: "email", recipient: email })
      .returning({ id: notificationDeliveries.id });
    await tryEnqueue(() => enqueueDeliverEmail(delivery.id), "deliver-email");
  }
  if (wantSms && profile?.phoneE164) {
    const [delivery] = await db
      .insert(notificationDeliveries)
      .values({ notificationId: notification.id, channel: "sms", recipient: profile.phoneE164 })
      .returning({ id: notificationDeliveries.id });
    await tryEnqueue(() => enqueueDeliverSms(delivery.id), "deliver-sms");
  }

  return notification.id;
}

/* ------------------------------------------------------------------ */
/* The opportunity-alert message                                       */
/* ------------------------------------------------------------------ */

export interface AlertDispatchInput {
  userId: string;
  ctx: OpportunityContext;
  grade: Grade;
  notes: string[];
  zoneName: string;
  channels: { inApp: boolean; email: boolean; sms: boolean };
  forceSms: boolean;
  realert: boolean;
}

export async function dispatchOpportunityAlert(db: Db, input: AlertDispatchInput): Promise<string> {
  const { ctx } = input;
  const pay = formatPay(ctx.opp);
  const nextDate = ctx.firstOpenStart
    ? DateTime.fromJSDate(ctx.firstOpenStart, { zone: ctx.opp.timezone }).toFormat("EEE, MMM d · h:mm a")
    : null;

  const lines = [
    `${ctx.orgName} · ${ctx.locationCity}`,
    pay ? `Pay: ${pay}` : null,
    nextDate ? `${ctx.opp.urgent ? "URGENT — " : ""}First date: ${nextDate}` : null,
    input.notes.length ? `Note: ${input.notes.join(" · ")}` : null,
    `Matched your zone "${input.zoneName}".`,
  ].filter(Boolean);

  return dispatchNotification(db, {
    userId: input.userId,
    category: "watch_match",
    kind: input.realert ? "watch_match_update" : "watch_match",
    title: `${input.realert ? "Updated" : input.grade === "exact" ? "Exact match" : "Close match"}: ${ctx.opp.title}`,
    body: lines.join("\n"),
    actionUrl: `${process.env.APP_BASE_URL ?? "http://localhost:4000"}/o/${ctx.opp.id}`,
    payload: {
      opportunityId: ctx.opp.id,
      grade: input.grade,
      realert: input.realert,
      urgent: ctx.opp.urgent,
    },
    requested: { email: input.channels.email, sms: input.channels.sms },
    forceSms: input.forceSms,
  });
}
