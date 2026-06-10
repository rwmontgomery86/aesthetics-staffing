import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { geography, geographyMultiPolygon, anonRole, authenticatedRole, isAdmin, myProviderId } from "./_shared";
import { matchGradeEnum, opportunityTypeEnum, payUnitEnum, watchZoneKindEnum } from "./enums";
import { providerProfiles } from "./providers";

/**
 * All four zone kinds materialize to ONE geography column at save time
 * (radius → ST_Buffer, polygon → WKT, city/zip → copied reference polygons),
 * so the matching engine sees a single geom + a single GIST index.
 * geometry_meta keeps the source shape for UI re-render + re-materialization.
 */
export const watchZones = pgTable(
  "watch_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: watchZoneKindEnum("kind").notNull(),
    geom: geography("geom").notNull(),
    geometryMeta: jsonb("geometry_meta").notNull(),
    // Filters: empty array = "all".
    opportunityTypes: opportunityTypeEnum("opportunity_types").array().notNull().default(sql`'{}'`),
    serviceIds: uuid("service_ids").array().notNull().default(sql`'{}'`),
    minPayCents: integer("min_pay_cents"),
    minPayUnit: payUnitEnum("min_pay_unit").notNull().default("hour"),
    daysOfWeek: smallint("days_of_week").array().notNull().default(sql`'{0,1,2,3,4,5,6}'`),
    // Interpreted in the OPPORTUNITY LOCATION's timezone at match time.
    timeStartLocal: time("time_start_local"),
    timeEndLocal: time("time_end_local"),
    urgentOnly: boolean("urgent_only").notNull().default(false),
    /** Exact-only vs exact+close alert preference, per zone. */
    alertGrades: matchGradeEnum("alert_grades").array().notNull().default(sql`'{exact,close}'`),
    channelInApp: boolean("channel_in_app").notNull().default(true),
    channelEmail: boolean("channel_email").notNull().default(true),
    channelSms: boolean("channel_sms").notNull().default(false),
    paused: boolean("paused").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("watch_zones_provider_idx").on(t.providerProfileId),
    pgPolicy("watch_zones_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}`,
    }),
    pgPolicy("watch_zones_write", {
      for: "all",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId}`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}`,
    }),
  ],
).enableRLS();

/** Census ZCTA polygons — Georgia loaded first; other states on demand.
 *  Known approximation: ZCTAs ≠ USPS routes (accepted, documented). */
export const geoZips = pgTable(
  "geo_zips",
  {
    zip: char("zip", { length: 5 }).primaryKey(),
    state: char("state", { length: 2 }).notNull(),
    city: text("city"),
    geog: geographyMultiPolygon("geog").notNull(),
  },
  (t) => [
    index("geo_zips_state_idx").on(t.state),
    pgPolicy("geo_zips_select", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`true`,
    }),
  ],
).enableRLS();

/** Census "places" polygons. */
export const geoCities = pgTable(
  "geo_cities",
  {
    geoid: text("geoid").primaryKey(),
    name: text("name").notNull(),
    state: char("state", { length: 2 }).notNull(),
    geog: geographyMultiPolygon("geog").notNull(),
  },
  (t) => [
    index("geo_cities_state_idx").on(t.state),
    pgPolicy("geo_cities_select", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`true`,
    }),
  ],
).enableRLS();
