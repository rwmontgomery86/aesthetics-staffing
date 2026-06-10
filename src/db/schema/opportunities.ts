import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { anonRole, authenticatedRole, isAdmin, authUid, myProviderId } from "./_shared";
import {
  applicationScopeEnum,
  applicationStatusEnum,
  bookingScopeEnum,
  bookingStatusEnum,
  completionStatusEnum,
  occurrenceStatusEnum,
  opportunityStatusEnum,
  opportunityTypeEnum,
  payKindEnum,
  payUnitEnum,
} from "./enums";
import { locations, organizations } from "./identity";
import { providerProfiles } from "./providers";
import { providerTypes, services } from "./taxonomy";

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    postedByUserId: uuid("posted_by_user_id").notNull(),
    type: opportunityTypeEnum("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    expectedVolume: text("expected_volume"),
    liabilityExpectations: text("liability_expectations"),
    notes: text("notes"),
    // Pay — visibility for shift-family types is enforced by a CHECK in
    // drizzle/manual/ (no hidden pay; fixed | range | negotiable_min).
    payKind: payKindEnum("pay_kind"),
    payUnit: payUnitEnum("pay_unit"),
    payMinCents: integer("pay_min_cents"),
    payMaxCents: integer("pay_max_cents"),
    // Recurrence template (RFC 5545); expanded to occurrences in the
    // location's timezone by the generate-occurrences cron.
    recurrenceRule: text("recurrence_rule"),
    recurrenceLocalStart: time("recurrence_local_start"),
    recurrenceDurationMin: integer("recurrence_duration_min"),
    recurrenceUntil: date("recurrence_until"),
    timezone: text("timezone").notNull().default("America/New_York"), // denorm from location
    urgent: boolean("urgent").notNull().default(false),
    /** Supervision/medical-director attestation captured at post time for
     *  injectable/laser posts (locked decision: free-text + attestation). */
    supervisionAttestedAt: timestamp("supervision_attested_at", { withTimezone: true }),
    slotCount: smallint("slot_count").notNull().default(1), // MVP UI fixed at 1
    applicationDeadline: timestamp("application_deadline", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: opportunityStatusEnum("status").notNull().default("draft"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("opportunities_status_posted_idx").on(t.status, t.postedAt),
    index("opportunities_org_idx").on(t.organizationId),
    pgPolicy("opportunities_select", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`${t.status} = 'posted'
        or (select public.is_org_member(${t.organizationId}))
        or ${isAdmin}`,
    }),
    pgPolicy("opportunities_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'poster'))
        and ${t.postedByUserId} = ${authUid}`,
    }),
    pgPolicy("opportunities_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`(select public.has_org_role(${t.organizationId}, 'poster')) or ${isAdmin}`,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'poster')) or ${isAdmin}`,
    }),
  ],
).enableRLS();

export const opportunityServices = pgTable(
  "opportunity_services",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.opportunityId, t.serviceId] }),
    pgPolicy("opportunity_services_select", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`exists (select 1 from opportunities o where o.id = ${t.opportunityId})`,
    }),
    pgPolicy("opportunity_services_write", {
      for: "all",
      to: authenticatedRole,
      using: sql`exists (select 1 from opportunities o where o.id = ${t.opportunityId}
        and (select public.has_org_role(o.organization_id, 'poster')))`,
      withCheck: sql`exists (select 1 from opportunities o where o.id = ${t.opportunityId}
        and (select public.has_org_role(o.organization_id, 'poster')))`,
    }),
  ],
).enableRLS();

export const opportunityProviderTypes = pgTable(
  "opportunity_provider_types",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    providerTypeId: uuid("provider_type_id")
      .notNull()
      .references(() => providerTypes.id, { onDelete: "cascade" }),
    licenseRequiredNote: text("license_required_note"),
  },
  (t) => [
    primaryKey({ columns: [t.opportunityId, t.providerTypeId] }),
    pgPolicy("opportunity_provider_types_select", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`exists (select 1 from opportunities o where o.id = ${t.opportunityId})`,
    }),
    pgPolicy("opportunity_provider_types_write", {
      for: "all",
      to: authenticatedRole,
      using: sql`exists (select 1 from opportunities o where o.id = ${t.opportunityId}
        and (select public.has_org_role(o.organization_id, 'poster')))`,
      withCheck: sql`exists (select 1 from opportunities o where o.id = ${t.opportunityId}
        and (select public.has_org_role(o.organization_id, 'poster')))`,
    }),
  ],
).enableRLS();

/**
 * EVERY opportunity with concrete times gets occurrences — a one-time shift
 * gets exactly one row. One uniform model for applications, bookings,
 * reminders, completion. part_time/full_time/contract/evergreen may have zero.
 */
export const opportunityOccurrences = pgTable(
  "opportunity_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: occurrenceStatusEnum("status").notNull().default("open"),
    rescheduledFromId: uuid("rescheduled_from_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("opportunity_occurrences_unique").on(t.opportunityId, t.startsAt),
    index("opportunity_occurrences_open_idx").on(t.startsAt).where(sql`status = 'open'`),
    pgPolicy("opportunity_occurrences_select", {
      for: "select",
      to: [anonRole, authenticatedRole],
      using: sql`exists (select 1 from opportunities o where o.id = ${t.opportunityId})`,
    }),
    pgPolicy("opportunity_occurrences_write", {
      for: "all",
      to: authenticatedRole,
      using: sql`exists (select 1 from opportunities o where o.id = ${t.opportunityId}
        and (select public.has_org_role(o.organization_id, 'poster')))`,
      withCheck: sql`exists (select 1 from opportunities o where o.id = ${t.opportunityId}
        and (select public.has_org_role(o.organization_id, 'poster')))`,
    }),
  ],
).enableRLS();

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    occurrenceId: uuid("occurrence_id").references(() => opportunityOccurrences.id, {
      onDelete: "cascade",
    }),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "cascade" }),
    scope: applicationScopeEnum("scope").notNull().default("series"),
    status: applicationStatusEnum("status").notNull().default("submitted"),
    message: text("message"),
    source: text("source").notNull().default("search"), // 'search' | 'watch_alert' | 'invite'
    watchZoneId: uuid("watch_zone_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("applications_series_unique")
      .on(t.opportunityId, t.providerProfileId)
      .where(sql`occurrence_id is null`),
    uniqueIndex("applications_occurrence_unique")
      .on(t.occurrenceId, t.providerProfileId)
      .where(sql`occurrence_id is not null`),
    index("applications_provider_status_idx").on(t.providerProfileId, t.status),
    pgPolicy("applications_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or exists (select 1 from opportunities o where o.id = ${t.opportunityId}
             and (select public.is_org_member(o.organization_id)))`,
    }),
    pgPolicy("applications_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.providerProfileId} = ${myProviderId}
        and exists (select 1 from opportunities o
              where o.id = ${t.opportunityId} and o.status = 'posted')`,
    }),
    // Provider may update own (withdraw); org members run status transitions.
    // Legal transitions are asserted app-side (assertTransition pattern).
    pgPolicy("applications_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or exists (select 1 from opportunities o where o.id = ${t.opportunityId}
             and (select public.has_org_role(o.organization_id, 'poster')))`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or exists (select 1 from opportunities o where o.id = ${t.opportunityId}
             and (select public.has_org_role(o.organization_id, 'poster')))`,
    }),
  ],
).enableRLS();

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "restrict" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    providerProfileId: uuid("provider_profile_id")
      .notNull()
      .references(() => providerProfiles.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(), // denorm
    locationId: uuid("location_id").notNull(), // denorm
    scope: bookingScopeEnum("scope").notNull(),
    status: bookingStatusEnum("status").notNull().default("confirmed"),
    providerConfirmedAt: timestamp("provider_confirmed_at", { withTimezone: true }),
    businessConfirmedAt: timestamp("business_confirmed_at", { withTimezone: true }),
    // Click-through boilerplate: versioned template, acceptance timestamps.
    termsVersion: text("terms_version").notNull().default("draft-0"),
    termsAcceptedProviderAt: timestamp("terms_accepted_provider_at", { withTimezone: true }),
    termsAcceptedBusinessAt: timestamp("terms_accepted_business_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    canceledByUserId: uuid("canceled_by_user_id"),
    cancellationReason: text("cancellation_reason"),
    adminNotes: text("admin_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bookings_provider_idx").on(t.providerProfileId),
    index("bookings_org_idx").on(t.organizationId),
    pgPolicy("bookings_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or (select public.is_org_member(${t.organizationId}))`,
    }),
    pgPolicy("bookings_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`(select public.has_org_role(${t.organizationId}, 'poster'))`,
    }),
    pgPolicy("bookings_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or (select public.has_org_role(${t.organizationId}, 'poster'))`,
      withCheck: sql`${t.providerProfileId} = ${myProviderId} or ${isAdmin}
        or (select public.has_org_role(${t.organizationId}, 'poster'))`,
    }),
  ],
).enableRLS();

/** Per-date status: cancellations/no-shows/disputes live here; series-level
 *  status on bookings. Supports provider A Mondays + provider B Wednesdays
 *  on one post with slot_count 2. */
export const bookingOccurrences = pgTable(
  "booking_occurrences",
  {
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => opportunityOccurrences.id, { onDelete: "cascade" }),
    status: bookingStatusEnum("status").notNull().default("confirmed"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    noShowReportedByUserId: uuid("no_show_reported_by_user_id"),
    adminNotes: text("admin_notes"),
  },
  (t) => [
    primaryKey({ columns: [t.bookingId, t.occurrenceId] }),
    index("booking_occurrences_occurrence_idx").on(t.occurrenceId),
    pgPolicy("booking_occurrences_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`exists (select 1 from bookings b where b.id = ${t.bookingId})`,
    }),
    pgPolicy("booking_occurrences_write", {
      for: "all",
      to: authenticatedRole,
      using: sql`exists (select 1 from bookings b where b.id = ${t.bookingId}
        and (b.provider_profile_id = ${myProviderId}
             or (select public.has_org_role(b.organization_id, 'poster'))))`,
      withCheck: sql`exists (select 1 from bookings b where b.id = ${t.bookingId}
        and (b.provider_profile_id = ${myProviderId}
             or (select public.has_org_role(b.organization_id, 'poster'))))`,
    }),
  ],
).enableRLS();

/** Invoice-ready, zero processing — no money moves in MVP. */
export const completionRecords = pgTable(
  "completion_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    occurrenceId: uuid("occurrence_id"),
    amountCents: integer("amount_cents").notNull(),
    payUnit: payUnitEnum("pay_unit").notNull(),
    unitsWorked: numeric("units_worked"),
    lineItems: jsonb("line_items").notNull().default(sql`'[]'::jsonb`),
    status: completionStatusEnum("status").notNull().default("pending"),
    confirmedByUserId: uuid("confirmed_by_user_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    invoiceNumber: text("invoice_number"),
    stripePaymentIntentId: text("stripe_payment_intent_id"), // future
    stripeInvoiceId: text("stripe_invoice_id"), // future
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("completion_records_booking_idx").on(t.bookingId),
    pgPolicy("completion_records_select", {
      for: "select",
      to: authenticatedRole,
      using: sql`exists (select 1 from bookings b where b.id = ${t.bookingId})`,
    }),
    pgPolicy("completion_records_insert", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`exists (select 1 from bookings b where b.id = ${t.bookingId}
        and (select public.has_org_role(b.organization_id, 'poster')))`,
    }),
    // Business edits units/status; provider may flip status to disputed —
    // both asserted app-side, gated here to booking parties.
    pgPolicy("completion_records_update", {
      for: "update",
      to: authenticatedRole,
      using: sql`exists (select 1 from bookings b where b.id = ${t.bookingId}
        and (b.provider_profile_id = ${myProviderId}
             or (select public.has_org_role(b.organization_id, 'poster')))) or ${isAdmin}`,
      withCheck: sql`exists (select 1 from bookings b where b.id = ${t.bookingId}
        and (b.provider_profile_id = ${myProviderId}
             or (select public.has_org_role(b.organization_id, 'poster')))) or ${isAdmin}`,
    }),
  ],
).enableRLS();
