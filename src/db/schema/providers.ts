import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { geographyPoint, authenticatedRole, isAdmin, authUid, myProviderId } from "./_shared";
import { payUnitEnum } from "./enums";
import { profiles } from "./identity";
import { providerTypes, services } from "./taxonomy";

export const providerProfiles = pgTable(
  "provider_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** Unguessable slug — provider profiles are never publicly indexed. */
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    headshotPath: text("headshot_path"),
    homeLocation: geographyPoint("home_location"),
    homeCity: text("home_city"),
    homeState: char("home_state", { length: 2 }),
    homeZip: text("home_zip"),
    travelRadiusM: integer("travel_radius_m"),
    yearsExperience: smallint("years_experience"),
    payMinCents: integer("pay_min_cents"),
    payMinUnit: payUnitEnum("pay_min_unit"),
    payStructuresAccepted: payUnitEnum("pay_structures_accepted").array().notNull().default(sql`'{}'`),
    urgentAvailable: boolean("urgent_available").notNull().default(false),
    availableNowStatus: text("available_now_status"), // 'today' | 'this_week' | null
    availableNowSetAt: timestamp("available_now_set_at", { withTimezone: true }),
    socialHandles: jsonb("social_handles").notNull().default(sql`'{}'::jsonb`),
    hiddenFromSearch: boolean("hidden_from_search").notNull().default(false),
    onboardingStatus: text("onboarding_status").notNull().default("started"),
    stripeAccountId: text("stripe_account_id"), // future; unused in MVP
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy("provider_profiles_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid} or ${isAdmin}
        or (not ${t.hiddenFromSearch})
        or (select public.org_has_grant(${t.id}))`,
    }),
    pgPolicy("provider_profiles_insert_own", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${authUid}`,
    }),
    pgPolicy("provider_profiles_update_own", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.userId} = ${authUid} or ${isAdmin}`,
      withCheck: sql`${t.userId} = ${authUid} or ${isAdmin}`,
    }),
  ],
).enableRLS();

/** Visibility of these child tables chains to provider_profiles RLS via the
 *  exists() subquery — the subquery runs under the querying user's policies. */
export const providerProfileTypes = pgTable(
  "provider_profile_types",
  {
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    providerTypeId: uuid("provider_type_id")
      .notNull()
      .references(() => providerTypes.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.providerProfileId, t.providerTypeId] }),
    pgPolicy("provider_profile_types_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`exists (select 1 from provider_profiles pp where pp.id = ${t.providerProfileId})`,
    }),
    pgPolicy("provider_profile_types_write", {
      for: "all",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId}`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
  ],
).enableRLS();

export const providerServices = pgTable(
  "provider_services",
  {
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    yearsExperience: smallint("years_experience"),
  },
  (t) => [
    primaryKey({ columns: [t.providerProfileId, t.serviceId] }),
    pgPolicy("provider_services_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`exists (select 1 from provider_profiles pp where pp.id = ${t.providerProfileId})`,
    }),
    pgPolicy("provider_services_write", {
      for: "all",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId}`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
  ],
).enableRLS();

/** Simple weekly availability template (MVP). Times are interpreted in the
 *  opportunity location's timezone at match time. */
export const providerAvailability = pgTable(
  "provider_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    dayOfWeek: smallint("day_of_week").notNull(), // 0–6, Sunday = 0
    timeStart: time("time_start").notNull(),
    timeEnd: time("time_end").notNull(),
    note: text("note"),
  },
  (t) => [
    index("provider_availability_provider_idx").on(t.providerProfileId),
    pgPolicy("provider_availability_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`exists (select 1 from provider_profiles pp where pp.id = ${t.providerProfileId})`,
    }),
    pgPolicy("provider_availability_write", {
      for: "all",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId}`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
  ],
).enableRLS();
