import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { authenticatedRole, isAdmin, authUid, myProviderId } from "./_shared";
import {
  deliveryStatusEnum,
  matchGradeEnum,
  notificationCategoryEnum,
  notificationChannelEnum,
} from "./enums";
import { profiles } from "./identity";
import { opportunities } from "./opportunities";
import { providerProfiles } from "./providers";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 40 }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    actionUrl: text("action_url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    // The ~25s unread-count polling query.
    index("notifications_unread_idx").on(t.userId).where(sql`read_at is null`),
    // Admin arm: the delivery explorer joins deliveries to their parent
    // notification (kind/title) — deviation from the §10 matrix, logged.
    pgPolicy("notifications_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid} or ${isAdmin}`,
    }),
    pgPolicy("notifications_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy("notifications_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
    }),
    // No INSERT policy — rows are written by the dispatcher (service role).
  ],
).enableRLS();

/** Per-channel compliance log — webhook-updated (Resend events, Twilio status
 *  callbacks). Bounce → future sends suppressed. The log NotifEyes lacked. */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    recipient: text("recipient").notNull(), // email or E.164
    status: deliveryStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"), // Resend id / Twilio SID
    error: text("error"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (t) => [
    index("notification_deliveries_provider_msg_idx").on(t.providerMessageId),
    index("notification_deliveries_status_idx").on(t.status, t.queuedAt),
    // Own rows visible (chains to notifications RLS); admin sees all.
    pgPolicy("notification_deliveries_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`exists (select 1 from notifications n where n.id = ${t.notificationId}) or ${isAdmin}`,
    }),
    // Writes: service role only (dispatcher + webhooks).
  ],
).enableRLS();

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    category: notificationCategoryEnum("category").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
    sms: boolean("sms").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.category] }),
    pgPolicy("notification_preferences_all_own", {
      for: "all",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

/** TCPA audit trail — STOP/START/HELP webhook writes + signup consent. */
export const smsConsentLog = pgTable(
  "sms_consent_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id"),
    phoneE164: text("phone_e164").notNull(),
    action: text("action").notNull(), // 'opt_in' | 'opt_out' | 'help'
    source: text("source").notNull(), // 'signup' | 'keyword' | 'admin'
    rawMessage: text("raw_message"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy("sms_consent_log_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid} or ${isAdmin}`,
    }),
    pgPolicy("sms_consent_log_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

/** The fanout dedup ledger: at most one alert per (opportunity, provider);
 *  ON CONFLICT DO NOTHING; max one re-alert (realerted_at IS NULL guard). */
export const opportunityAlerts = pgTable(
  "opportunity_alerts",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    watchZoneId: uuid("watch_zone_id"),
    matchGrade: matchGradeEnum("match_grade").notNull(),
    /** Per-criterion verdicts for debugging/threshold tuning. */
    score: jsonb("score").notNull().default(sql`'{}'::jsonb`),
    matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
    notificationId: uuid("notification_id"),
    realertedAt: timestamp("realerted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.opportunityId, t.providerProfileId] }),
    index("opportunity_alerts_provider_idx").on(t.providerProfileId),
    pgPolicy("opportunity_alerts_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}`,
    }),
    // Writes: matching worker only (service role).
  ],
).enableRLS();
