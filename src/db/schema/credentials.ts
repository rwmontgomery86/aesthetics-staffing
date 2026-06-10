import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, isAdmin, authUid, myProviderId } from "./_shared";
import { credentialStatusEnum, requirementLevelEnum } from "./enums";
import { providerProfiles } from "./providers";
import { providerTypes, serviceCategories, services } from "./taxonomy";
import { organizations } from "./identity";

export const credentialTypes = pgTable(
  "credential_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    requiresDocument: boolean("requires_document").notNull().default(false),
    requiresExpiry: boolean("requires_expiry").notNull().default(false),
    requiresLicenseNumber: boolean("requires_license_number").notNull().default(false),
    active: boolean("active").notNull().default(true),
  },
  () => [
    pgPolicy("credential_types_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

/**
 * The requirements rules engine — DATA, not code. Applicable requirements for
 * a provider/opportunity = UNION of rows matching its provider type(s), its
 * services' categories, and its specific services, scoped to state (null =
 * all states). Georgia seed rows are DRAFT until attorney validation.
 */
export const credentialRequirements = pgTable(
  "credential_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    credentialTypeId: uuid("credential_type_id")
      .notNull()
      .references(() => credentialTypes.id, { onDelete: "cascade" }),
    providerTypeId: uuid("provider_type_id").references(() => providerTypes.id, {
      onDelete: "cascade",
    }),
    serviceCategoryId: uuid("service_category_id").references(() => serviceCategories.id, {
      onDelete: "cascade",
    }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "cascade" }),
    state: char("state", { length: 2 }),
    level: requirementLevelEnum("level").notNull().default("required"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
  },
  (t) => [
    // CHECK (at least one attachment point) lives in drizzle/manual/ —
    // drizzle-kit 0.28 can't emit check constraints.
    pgPolicy("credential_requirements_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`true`,
    }),
  ],
).enableRLS();

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    credentialTypeId: uuid("credential_type_id")
      .notNull()
      .references(() => credentialTypes.id, { onDelete: "restrict" }),
    state: char("state", { length: 2 }),
    status: credentialStatusEnum("status").notNull().default("not_provided"),
    licenseNumber: text("license_number"),
    issuingBoard: text("issuing_board"),
    issuedAt: date("issued_at"),
    expiresAt: date("expires_at"),
    selfAttestedAt: timestamp("self_attested_at", { withTimezone: true }),
    submittedForReviewAt: timestamp("submitted_for_review_at", { withTimezone: true }),
    // Review columns are protected by trigger: only platform admins may set
    // them or the admin_reviewed / rejected_needs_info statuses.
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_credentials_unique").on(t.providerProfileId, t.credentialTypeId, t.state),
    index("provider_credentials_expiry_idx")
      .on(t.expiresAt)
      .where(sql`status in ('self_attested','document_uploaded','needs_review','admin_reviewed')`),
    pgPolicy("provider_credentials_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or (select public.org_has_grant(${t.providerProfileId}))`,
    }),
    pgPolicy("provider_credentials_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
    pgPolicy("provider_credentials_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}`,
    }),
    pgPolicy("provider_credentials_delete_own", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId}
        and ${t.status} in ('not_provided', 'self_attested')`,
    }),
  ],
).enableRLS();

export const credentialDocuments = pgTable(
  "credential_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerCredentialId: uuid("provider_credential_id")
      .notNull()
      .references(() => providerCredentials.id, { onDelete: "cascade" }),
    /** Storage PATH in the private `credentials` bucket — never a URL. */
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("credential_documents_credential_idx").on(t.providerCredentialId),
    // Visibility chains to the parent credential's RLS via subquery.
    pgPolicy("credential_documents_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`exists (select 1 from provider_credentials pc where pc.id = ${t.providerCredentialId})`,
    }),
    pgPolicy("credential_documents_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`exists (select 1 from provider_credentials pc
        where pc.id = ${t.providerCredentialId} and pc.provider_profile_id = ${myProviderId})`,
    }),
    pgPolicy("credential_documents_delete", {
      for: "delete",
      to: authenticatedRole,
      using: sql`exists (select 1 from provider_credentials pc
        where pc.id = ${t.providerCredentialId} and pc.provider_profile_id = ${myProviderId})`,
    }),
  ],
).enableRLS();

export const portfolioItems = pgTable(
  "portfolio_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    /** Storage PATH in the private `portfolios` bucket — never a URL. */
    storagePath: text("storage_path").notNull(),
    caption: text("caption"),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    /** Provider attests rights/consent at upload — required, not optional. */
    consentAttestedAt: timestamp("consent_attested_at", { withTimezone: true }).notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("portfolio_items_provider_idx").on(t.providerProfileId),
    pgPolicy("portfolio_items_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or (select public.org_has_grant(${t.providerProfileId}))`,
    }),
    pgPolicy("portfolio_items_write", {
      for: "all",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId}`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
  ],
).enableRLS();

/**
 * THE single privacy gate for credentials + portfolios: an org can see a
 * provider's credentials/portfolio iff an unrevoked grant row exists.
 * Auto-created when the provider applies; manually grantable; revocable.
 */
export const profileAccessGrants = pgTable(
  "profile_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    grantedVia: text("granted_via").notNull().default("application"), // 'application' | 'manual'
    applicationId: uuid("application_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("profile_access_grants_unique").on(t.providerProfileId, t.organizationId),
    index("profile_access_grants_org_idx").on(t.organizationId),
    pgPolicy("profile_access_grants_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or (select public.is_org_member(${t.organizationId}))`,
    }),
    pgPolicy("profile_access_grants_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
    pgPolicy("profile_access_grants_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId}`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
  ],
).enableRLS();
