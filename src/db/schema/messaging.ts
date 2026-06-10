import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, isAdmin, authUid, myProviderId } from "./_shared";
import { organizations } from "./identity";
import { opportunities } from "./opportunities";
import { providerProfiles } from "./providers";
import { profiles } from "./identity";

/**
 * Threads are ALWAYS context-bound to an opportunity + provider + org.
 * contact_revealed_at is set when the booking is confirmed — before that,
 * outgoing messages are regex-screened for contact info (warn-and-flag).
 * is_thread_participant() is SECURITY DEFINER (bootstrap) to avoid the
 * self-referencing-policy recursion on thread_participants.
 */
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id"),
    bookingId: uuid("booking_id"),
    contactRevealedAt: timestamp("contact_revealed_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("threads_opportunity_provider_unique").on(t.opportunityId, t.providerProfileId),
    index("threads_org_idx").on(t.organizationId),
    index("threads_provider_idx").on(t.providerProfileId),
    pgPolicy("threads_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or (select public.is_org_member(${t.organizationId}))`,
    }),
    pgPolicy("threads_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}
        or (select public.has_org_role(${t.organizationId}, 'poster'))`,
    }),
    // last_message_at / contact_revealed_at / booking linkage updates happen
    // under the acting party; semantics are protected app-side.
    pgPolicy("threads_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or (select public.is_org_member(${t.organizationId}))`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or (select public.is_org_member(${t.organizationId}))`,
    }),
  ],
).enableRLS();

export const threadParticipants = pgTable(
  "thread_participants",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.userId] }),
    index("thread_participants_user_idx").on(t.userId),
    // Visibility chains to threads RLS (org members + provider + admin).
    pgPolicy("thread_participants_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`exists (select 1 from threads t where t.id = ${t.threadId})`,
    }),
    // Lazy join: you may add YOURSELF to any thread you can see.
    pgPolicy("thread_participants_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}
        and exists (select 1 from threads t where t.id = ${t.threadId})`,
    }),
    pgPolicy("thread_participants_update_self", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid}`,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
  ],
).enableRLS();

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id"), // null = system message
    body: text("body").notNull(),
    attachments: jsonb("attachments").notNull().default(sql`'[]'::jsonb`),
    /** Regex-detected phone/email BEFORE contact reveal — warn + flag for
     *  admin, never silently dropped. */
    contactFlagged: boolean("contact_flagged").notNull().default(false),
    systemKind: text("system_kind"),
    systemPayload: jsonb("system_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_thread_idx").on(t.threadId, t.createdAt),
    pgPolicy("messages_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select public.is_thread_participant(${t.threadId})) or ${isAdmin}`,
    }),
    pgPolicy("messages_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.senderUserId} = ${authUid}
        and (select public.is_thread_participant(${t.threadId}))
        and exists (select 1 from threads t where t.id = ${t.threadId} and t.locked_at is null)`,
    }),
    // No update/delete — messages are immutable.
  ],
).enableRLS();
