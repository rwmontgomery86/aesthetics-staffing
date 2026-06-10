import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, isAdmin, myProviderId } from "./_shared";
import { bookings } from "./opportunities";
import { providerProfiles } from "./providers";

/**
 * Append-only. INSERT happens ONLY via the record_audit() SECURITY DEFINER
 * function (bootstrap); table DML is revoked from authenticated in
 * drizzle/manual/ grants. Admin-only SELECT.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: uuid("actor_user_id"),
    actingAs: text("acting_as").notNull().default("system"), // provider | org_member | admin | system
    organizationId: uuid("organization_id"),
    action: text("action").notNull(), // e.g. 'credential.reviewed', 'user.suspended'
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    changes: jsonb("changes").notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
    pgPolicy("audit_logs_select_admin", {
      for: "select",
      to: authenticatedRole,
      using: isAdmin,
    }),
  ],
).enableRLS();

/**
 * Every credential/portfolio signed-URL issuance and admin view. Providers
 * can see who accessed THEIR documents (transparency feature).
 * Writes via record_document_access() definer fn / service role only.
 */
export const documentAccessLogs = pgTable(
  "document_access_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    accessorUserId: uuid("accessor_user_id").notNull(),
    organizationId: uuid("organization_id"),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    documentKind: text("document_kind").notNull(), // 'credential' | 'portfolio'
    documentId: uuid("document_id").notNull(),
    accessKind: text("access_kind").notNull(), // 'signed_url_issued' | 'admin_view'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_access_logs_provider_idx").on(t.providerProfileId, t.createdAt),
    pgPolicy("document_access_logs_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}`,
    }),
  ],
).enableRLS();

/**
 * FUTURE-READY, NOT BUILT: table exists so the booking spine never needs a
 * migration when reviews ship. RLS enabled with NO policies = deny-all for
 * authenticated; no UI in MVP.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    authorKind: text("author_kind").notNull(), // 'provider' | 'business'
    authorUserId: uuid("author_user_id").notNull(),
    rating: smallint("rating").notNull(),
    body: text("body"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reviews_booking_author_unique").on(t.bookingId, t.authorKind)],
).enableRLS();
