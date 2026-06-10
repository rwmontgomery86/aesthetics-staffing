import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, myProviderId } from "./_shared";
import { organizations } from "./identity";
import { providerProfiles } from "./providers";

/** Org favorites a provider. Providers cannot see who favorited them (privacy). */
export const orgFavoriteProviders = pgTable(
  "org_favorite_providers",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.providerProfileId] }),
    pgPolicy("org_favorite_providers_all", {
      for: "all",
      to: authenticatedRole,
      using: sql`(select public.has_org_role(${t.organizationId}, 'poster'))`,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'poster'))`,
    }),
  ],
).enableRLS();

export const providerFavoriteOrgs = pgTable(
  "provider_favorite_orgs",
  {
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.providerProfileId, t.organizationId] }),
    pgPolicy("provider_favorite_orgs_all", {
      for: "all",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId}`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
  ],
).enableRLS();

/** Blocks exclude matching in both directions (NotifEyes blocklist pattern). */
export const providerOrgBlocks = pgTable(
  "provider_org_blocks",
  {
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.providerProfileId, t.organizationId] }),
    pgPolicy("provider_org_blocks_all", {
      for: "all",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId}`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
  ],
).enableRLS();

export const orgProviderBlocks = pgTable(
  "org_provider_blocks",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.providerProfileId] }),
    pgPolicy("org_provider_blocks_all", {
      for: "all",
      to: authenticatedRole,
      using: sql`(select public.has_org_role(${t.organizationId}, 'poster'))`,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'poster'))`,
    }),
  ],
).enableRLS();
