import { pgEnum } from "drizzle-orm/pg-core";

export const orgMemberRoleEnum = pgEnum("org_member_role", ["owner", "admin", "poster"]);

// training_event / room_rental / evergreen exist now; the first two are
// UI-gated "coming soon" in MVP.
export const opportunityTypeEnum = pgEnum("opportunity_type", [
  "one_time_shift",
  "recurring_shift",
  "part_time",
  "full_time",
  "contract",
  "popup_event",
  "training_event",
  "room_rental",
  "evergreen",
]);

export const opportunityStatusEnum = pgEnum("opportunity_status", [
  "draft",
  "posted",
  "filled",
  "expired",
  "canceled",
  "archived",
]);

export const occurrenceStatusEnum = pgEnum("occurrence_status", [
  "open",
  "booked",
  "completed",
  "canceled",
]);

export const payKindEnum = pgEnum("pay_kind", ["fixed", "range", "negotiable_min"]);

export const payUnitEnum = pgEnum("pay_unit", [
  "hour",
  "day",
  "per_treatment",
  "commission_pct",
  "salary_year",
  "flat",
]);

export const applicationScopeEnum = pgEnum("application_scope", ["series", "occurrence"]);

export const applicationStatusEnum = pgEnum("application_status", [
  "submitted",
  "viewed",
  "shortlisted",
  "offered",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
]);

export const bookingScopeEnum = pgEnum("booking_scope", ["series", "occurrences"]);

export const bookingStatusEnum = pgEnum("booking_status", [
  "confirmed",
  "completed",
  "canceled_by_provider",
  "canceled_by_business",
  "canceled_by_admin",
  "no_show_provider",
  "no_show_business",
  "disputed",
]);

// expiring_soon / expired are DERIVED from expires_at, never stored.
export const credentialStatusEnum = pgEnum("credential_status", [
  "not_provided",
  "self_attested",
  "document_uploaded",
  "needs_review",
  "admin_reviewed",
  "rejected_needs_info",
]);

export const requirementLevelEnum = pgEnum("requirement_level", ["required", "recommended"]);

export const watchZoneKindEnum = pgEnum("watch_zone_kind", ["radius", "polygon", "city", "zip"]);

export const matchGradeEnum = pgEnum("match_grade", ["exact", "close"]);

export const notificationChannelEnum = pgEnum("notification_channel", ["in_app", "email", "sms"]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "queued",
  "sent",
  "delivered",
  "failed",
  "bounced",
  "suppressed",
]);

export const completionStatusEnum = pgEnum("completion_status", [
  "pending",
  "confirmed",
  "disputed",
  "voided",
]);

export const notificationCategoryEnum = pgEnum("notification_category", [
  "watch_match",
  "application_activity",
  "booking_activity",
  "messages",
  "credentials",
  "reminders",
  "admin",
  "marketing",
]);
