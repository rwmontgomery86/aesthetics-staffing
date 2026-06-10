import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { geographyPoint, anonRole, authenticatedRole, isAdmin, authUid } from "./_shared";
import { orgMemberRoleEnum } from "./enums";

/**
 * 1:1 with auth.users (id = auth.users.id; FK added in manual SQL because the
 * auth schema is not managed by drizzle). Created by trigger on signup.
 */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(),
    fullName: text("full_name").notNull().default(""),
    phoneE164: text("phone_e164"),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    timezone: text("timezone").notNull().default("America/New_York"),
    avatarPath: text("avatar_path"),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    emailOptedIn: boolean("email_opted_in").notNull().default(true),
    smsOptedIn: boolean("sms_opted_in").notNull().default(false),
    smsOptOutAt: timestamp("sms_opt_out_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy("profiles_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.id} = ${authUid} or ${isAdmin} or exists (
        select 1 from organization_members m1
        join organization_members m2 on m2.organization_id = m1.organization_id
        where m1.user_id = ${authUid} and m2.user_id = ${t.id}
      )`,
    }),
    pgPolicy("profiles_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.id} = ${authUid}`,
      withCheck: sql`${t.id} = ${authUid}`,
    }),
    pgPolicy("profiles_update_admin", {
      for: "update",
      to: authenticatedRole,
      using: isAdmin,
      withCheck: isAdmin,
    }),
    // No INSERT policy: rows are created by the auth.users trigger (definer).
  ],
).enableRLS();

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    kind: text("kind").notNull().default("other"),
    description: text("description"),
    website: text("website"),
    phone: text("phone"),
    logoPath: text("logo_path"),
    softwareEmrPos: text("software_emr_pos"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"), // future; unused in MVP
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Org profiles are business-public (opportunity pages, SEO).
    pgPolicy("organizations_select_public", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`true`,
    }),
    pgPolicy("organizations_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.createdByUserId} = ${authUid}`,
    }),
    pgPolicy("organizations_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select public.has_org_role(${t.id}, 'admin')) or ${isAdmin}`,
      withCheck: sql`(select public.has_org_role(${t.id}, 'admin')) or ${isAdmin}`,
    }),
  ],
).enableRLS();

/** Admin-only notes, separated so the publicly-selectable org row can't leak them. */
export const organizationAdminNotes = pgTable(
  "organization_admin_notes",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    notes: text("notes"),
    flags: jsonb("flags").notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy("org_admin_notes_all_admin", {
      for: "all",
      to: authenticatedRole,
      using: isAdmin,
      withCheck: isAdmin,
    }),
  ],
).enableRLS();

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: orgMemberRoleEnum("role").notNull().default("poster"),
    title: text("title"),
    invitedByUserId: uuid("invited_by_user_id"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index("organization_members_user_idx").on(t.userId),
    pgPolicy("org_members_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select public.is_org_member(${t.organizationId})) or ${isAdmin}`,
    }),
    // Three legitimate insert paths: founder self-bootstrap as owner of an org
    // they just created; org admin adding a member; invitee accepting (email
    // claim must match a live invite).
    pgPolicy("org_members_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`
        (select public.has_org_role(${t.organizationId}, 'admin'))
        or (
          ${t.userId} = ${authUid} and ${t.role} = 'owner'
          and exists (
            select 1 from organizations o
            where o.id = ${t.organizationId} and o.created_by_user_id = ${authUid}
          )
          and not exists (
            select 1 from organization_members m where m.organization_id = ${t.organizationId}
          )
        )
        or (
          ${t.userId} = ${authUid}
          and exists (
            select 1 from organization_invites i
            where i.organization_id = ${t.organizationId}
              and lower(i.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
              and i.expires_at > now()
              and i.accepted_by_user_id is null
          )
        )`,
    }),
    pgPolicy("org_members_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select public.has_org_role(${t.organizationId}, 'admin')) or ${isAdmin}`,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'admin')) or ${isAdmin}`,
    }),
    pgPolicy("org_members_delete", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid} or (select public.has_org_role(${t.organizationId}, 'admin')) or ${isAdmin}`,
    }),
  ],
).enableRLS();

export const organizationInvites = pgTable(
  "organization_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: orgMemberRoleEnum("role").notNull().default("poster"),
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: uuid("invited_by_user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedByUserId: uuid("accepted_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("organization_invites_org_idx").on(t.organizationId),
    pgPolicy("org_invites_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`(select public.has_org_role(${t.organizationId}, 'admin')) or ${isAdmin}
        or lower(${t.email}) = lower(coalesce((select auth.jwt() ->> 'email'), ''))`,
    }),
    pgPolicy("org_invites_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'admin'))`,
    }),
    pgPolicy("org_invites_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select public.has_org_role(${t.organizationId}, 'admin'))
        or lower(${t.email}) = lower(coalesce((select auth.jwt() ->> 'email'), ''))`,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'admin'))
        or ${t.acceptedByUserId} = ${authUid}`,
    }),
    pgPolicy("org_invites_delete", {
      for: "delete",
      to: authenticatedRole,
      using: sql`(select public.has_org_role(${t.organizationId}, 'admin'))`,
    }),
  ],
).enableRLS();

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    state: char("state", { length: 2 }).notNull(),
    zip: text("zip").notNull(),
    geog: geographyPoint("geog"),
    timezone: text("timezone").notNull().default("America/New_York"),
    phone: text("phone"),
    parkingNotes: text("parking_notes"),
    dressCode: text("dress_code"),
    // Free-text supervision/medical-director context as DESCRIBED BY the
    // business (locked decision: structured org credentials are V2; injectable
    // and laser posts additionally require an attestation checkbox at post time).
    supervisionContext: text("supervision_context"),
    equipment: jsonb("equipment").notNull().default(sql`'[]'::jsonb`),
    productsBrands: jsonb("products_brands").notNull().default(sql`'[]'::jsonb`),
    photos: jsonb("photos").notNull().default(sql`'[]'::jsonb`),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("locations_org_idx").on(t.organizationId),
    pgPolicy("locations_select_public", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`true`,
    }),
    pgPolicy("locations_write", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'admin'))`,
    }),
    pgPolicy("locations_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select public.has_org_role(${t.organizationId}, 'admin')) or ${isAdmin}`,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'admin')) or ${isAdmin}`,
    }),
  ],
).enableRLS();
