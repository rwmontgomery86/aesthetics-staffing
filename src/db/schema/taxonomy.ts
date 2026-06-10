import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgPolicy,
  pgTable,
  smallint,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { anonRole, authenticatedRole } from "./_shared";

/**
 * Seeded lookup tables, not enums — they drive SEO pages and credential
 * requirements. Writes happen only through the service role (seeds/admin).
 * Readable by anon because public SEO pages render from them.
 */

export const providerTypes = pgTable(
  "provider_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    requiresStateLicense: boolean("requires_state_license").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  () => [
    pgPolicy("provider_types_select_all", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`true`,
    }),
  ],
).enableRLS();

export const serviceCategories = pgTable(
  "service_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** 1 low … 3 high — drives credential-review prioritization and UI flagging. */
    riskTier: smallint("risk_tier").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  () => [
    pgPolicy("service_categories_select_all", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`true`,
    }),
  ],
).enableRLS();

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => serviceCategories.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  () => [
    pgPolicy("services_select_all", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`true`,
    }),
  ],
).enableRLS();
