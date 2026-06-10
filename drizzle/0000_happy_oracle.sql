CREATE TYPE "public"."application_scope" AS ENUM('series', 'occurrence');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('submitted', 'viewed', 'shortlisted', 'offered', 'accepted', 'declined', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."booking_scope" AS ENUM('series', 'occurrences');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'completed', 'canceled_by_provider', 'canceled_by_business', 'canceled_by_admin', 'no_show_provider', 'no_show_business', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."completion_status" AS ENUM('pending', 'confirmed', 'disputed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('not_provided', 'self_attested', 'document_uploaded', 'needs_review', 'admin_reviewed', 'rejected_needs_info');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'bounced', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."match_grade" AS ENUM('exact', 'close');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('watch_match', 'application_activity', 'booking_activity', 'messages', 'credentials', 'reminders', 'admin', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('open', 'booked', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('draft', 'posted', 'filled', 'expired', 'canceled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type" AS ENUM('one_time_shift', 'recurring_shift', 'part_time', 'full_time', 'contract', 'popup_event', 'training_event', 'room_rental', 'evergreen');--> statement-breakpoint
CREATE TYPE "public"."org_member_role" AS ENUM('owner', 'admin', 'poster');--> statement-breakpoint
CREATE TYPE "public"."pay_kind" AS ENUM('fixed', 'range', 'negotiable_min');--> statement-breakpoint
CREATE TYPE "public"."pay_unit" AS ENUM('hour', 'day', 'per_treatment', 'commission_pct', 'salary_year', 'flat');--> statement-breakpoint
CREATE TYPE "public"."requirement_level" AS ENUM('required', 'recommended');--> statement-breakpoint
CREATE TYPE "public"."watch_zone_kind" AS ENUM('radius', 'polygon', 'city', 'zip');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state" char(2) NOT NULL,
	"zip" text NOT NULL,
	"geog" geography(Point, 4326),
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"phone" text,
	"parking_notes" text,
	"dress_code" text,
	"supervision_context" text,
	"equipment" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"products_brands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_admin_notes" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"notes" text,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_admin_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "org_member_role" DEFAULT 'poster' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_member_role" DEFAULT 'poster' NOT NULL,
	"title" text,
	"invited_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"description" text,
	"website" text,
	"phone" text,
	"logo_path" text,
	"software_emr_pos" text,
	"verified_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"phone_e164" text,
	"phone_verified_at" timestamp with time zone,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"avatar_path" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"email_opted_in" boolean DEFAULT true NOT NULL,
	"sms_opted_in" boolean DEFAULT false NOT NULL,
	"sms_opt_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"requires_state_license" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "provider_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "provider_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"risk_tier" smallint DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "service_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "services_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"time_start" time NOT NULL,
	"time_end" time NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "provider_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_profile_types" (
	"provider_profile_id" uuid NOT NULL,
	"provider_type_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "provider_profile_types_provider_profile_id_provider_type_id_pk" PRIMARY KEY("provider_profile_id","provider_type_id")
);
--> statement-breakpoint
ALTER TABLE "provider_profile_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"headshot_path" text,
	"home_location" geography(Point, 4326),
	"home_city" text,
	"home_state" char(2),
	"home_zip" text,
	"travel_radius_m" integer,
	"years_experience" smallint,
	"pay_min_cents" integer,
	"pay_min_unit" "pay_unit",
	"pay_structures_accepted" "pay_unit"[] DEFAULT '{}' NOT NULL,
	"urgent_available" boolean DEFAULT false NOT NULL,
	"available_now_status" text,
	"available_now_set_at" timestamp with time zone,
	"social_handles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hidden_from_search" boolean DEFAULT false NOT NULL,
	"onboarding_status" text DEFAULT 'started' NOT NULL,
	"stripe_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "provider_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "provider_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_services" (
	"provider_profile_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"years_experience" smallint,
	CONSTRAINT "provider_services_provider_profile_id_service_id_pk" PRIMARY KEY("provider_profile_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "provider_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credential_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_credential_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credential_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_type_id" uuid NOT NULL,
	"provider_type_id" uuid,
	"service_category_id" uuid,
	"service_id" uuid,
	"state" char(2),
	"level" "requirement_level" DEFAULT 'required' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "credential_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credential_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"requires_document" boolean DEFAULT false NOT NULL,
	"requires_expiry" boolean DEFAULT false NOT NULL,
	"requires_license_number" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "credential_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "credential_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"caption" text,
	"service_id" uuid,
	"consent_attested_at" timestamp with time zone NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"granted_via" text DEFAULT 'application' NOT NULL,
	"application_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "profile_access_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"credential_type_id" uuid NOT NULL,
	"state" char(2),
	"status" "credential_status" DEFAULT 'not_provided' NOT NULL,
	"license_number" text,
	"issuing_board" text,
	"issued_at" date,
	"expires_at" date,
	"self_attested_at" timestamp with time zone,
	"submitted_for_review_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_cities" (
	"geoid" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" char(2) NOT NULL,
	"geog" geography(MultiPolygon, 4326) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "geo_cities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geo_zips" (
	"zip" char(5) PRIMARY KEY NOT NULL,
	"state" char(2) NOT NULL,
	"city" text,
	"geog" geography(MultiPolygon, 4326) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "geo_zips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watch_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "watch_zone_kind" NOT NULL,
	"geom" geography(Geometry, 4326) NOT NULL,
	"geometry_meta" jsonb NOT NULL,
	"opportunity_types" "opportunity_type"[] DEFAULT '{}' NOT NULL,
	"service_ids" uuid[] DEFAULT '{}' NOT NULL,
	"min_pay_cents" integer,
	"min_pay_unit" "pay_unit" DEFAULT 'hour' NOT NULL,
	"days_of_week" smallint[] DEFAULT '{0,1,2,3,4,5,6}' NOT NULL,
	"time_start_local" time,
	"time_end_local" time,
	"urgent_only" boolean DEFAULT false NOT NULL,
	"alert_grades" "match_grade"[] DEFAULT '{exact,close}' NOT NULL,
	"channel_in_app" boolean DEFAULT true NOT NULL,
	"channel_email" boolean DEFAULT true NOT NULL,
	"channel_sms" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_zones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"occurrence_id" uuid,
	"provider_profile_id" uuid NOT NULL,
	"scope" "application_scope" DEFAULT 'series' NOT NULL,
	"status" "application_status" DEFAULT 'submitted' NOT NULL,
	"message" text,
	"source" text DEFAULT 'search' NOT NULL,
	"watch_zone_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_occurrences" (
	"booking_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancellation_reason" text,
	"no_show_reported_by_user_id" uuid,
	"admin_notes" text,
	CONSTRAINT "booking_occurrences_booking_id_occurrence_id_pk" PRIMARY KEY("booking_id","occurrence_id")
);
--> statement-breakpoint
ALTER TABLE "booking_occurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"scope" "booking_scope" NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"provider_confirmed_at" timestamp with time zone,
	"business_confirmed_at" timestamp with time zone,
	"terms_version" text DEFAULT 'draft-0' NOT NULL,
	"terms_accepted_provider_at" timestamp with time zone,
	"terms_accepted_business_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"canceled_by_user_id" uuid,
	"cancellation_reason" text,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "completion_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"occurrence_id" uuid,
	"amount_cents" integer NOT NULL,
	"pay_unit" "pay_unit" NOT NULL,
	"units_worked" numeric,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "completion_status" DEFAULT 'pending' NOT NULL,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"invoice_number" text,
	"stripe_payment_intent_id" text,
	"stripe_invoice_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "completion_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"posted_by_user_id" uuid NOT NULL,
	"type" "opportunity_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"expected_volume" text,
	"liability_expectations" text,
	"notes" text,
	"pay_kind" "pay_kind",
	"pay_unit" "pay_unit",
	"pay_min_cents" integer,
	"pay_max_cents" integer,
	"recurrence_rule" text,
	"recurrence_local_start" time,
	"recurrence_duration_min" integer,
	"recurrence_until" date,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"supervision_attested_at" timestamp with time zone,
	"slot_count" smallint DEFAULT 1 NOT NULL,
	"application_deadline" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" "opportunity_status" DEFAULT 'draft' NOT NULL,
	"posted_at" timestamp with time zone,
	"filled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "occurrence_status" DEFAULT 'open' NOT NULL,
	"rescheduled_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_occurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_provider_types" (
	"opportunity_id" uuid NOT NULL,
	"provider_type_id" uuid NOT NULL,
	"license_required_note" text,
	CONSTRAINT "opportunity_provider_types_opportunity_id_provider_type_id_pk" PRIMARY KEY("opportunity_id","provider_type_id")
);
--> statement-breakpoint
ALTER TABLE "opportunity_provider_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_services" (
	"opportunity_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "opportunity_services_opportunity_id_service_id_pk" PRIMARY KEY("opportunity_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "opportunity_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"body" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact_flagged" boolean DEFAULT false NOT NULL,
	"system_kind" text,
	"system_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread_participants" (
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "thread_participants_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "thread_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"application_id" uuid,
	"booking_id" uuid,
	"contact_revealed_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"recipient" text NOT NULL,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"user_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_preferences_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_url" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_alerts" (
	"opportunity_id" uuid NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"watch_zone_id" uuid,
	"match_grade" "match_grade" NOT NULL,
	"score" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notification_id" uuid,
	"realerted_at" timestamp with time zone,
	CONSTRAINT "opportunity_alerts_opportunity_id_provider_profile_id_pk" PRIMARY KEY("opportunity_id","provider_profile_id")
);
--> statement-breakpoint
ALTER TABLE "opportunity_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_consent_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"phone_e164" text NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"raw_message" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_consent_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_favorite_providers" (
	"organization_id" uuid NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_favorite_providers_organization_id_provider_profile_id_pk" PRIMARY KEY("organization_id","provider_profile_id")
);
--> statement-breakpoint
ALTER TABLE "org_favorite_providers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_provider_blocks" (
	"organization_id" uuid NOT NULL,
	"provider_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_provider_blocks_organization_id_provider_profile_id_pk" PRIMARY KEY("organization_id","provider_profile_id")
);
--> statement-breakpoint
ALTER TABLE "org_provider_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_favorite_orgs" (
	"provider_profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_favorite_orgs_provider_profile_id_organization_id_pk" PRIMARY KEY("provider_profile_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "provider_favorite_orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_org_blocks" (
	"provider_profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_org_blocks_provider_profile_id_organization_id_pk" PRIMARY KEY("provider_profile_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "provider_org_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"acting_as" text DEFAULT 'system' NOT NULL,
	"organization_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_access_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"accessor_user_id" uuid NOT NULL,
	"organization_id" uuid,
	"provider_profile_id" uuid NOT NULL,
	"document_kind" text NOT NULL,
	"document_id" uuid NOT NULL,
	"access_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_access_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"author_kind" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"body" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_admin_notes" ADD CONSTRAINT "organization_admin_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "services" ADD CONSTRAINT "services_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_availability" ADD CONSTRAINT "provider_availability_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_profile_types" ADD CONSTRAINT "provider_profile_types_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_profile_types" ADD CONSTRAINT "provider_profile_types_provider_type_id_provider_types_id_fk" FOREIGN KEY ("provider_type_id") REFERENCES "public"."provider_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credential_documents" ADD CONSTRAINT "credential_documents_provider_credential_id_provider_credentials_id_fk" FOREIGN KEY ("provider_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credential_requirements" ADD CONSTRAINT "credential_requirements_credential_type_id_credential_types_id_fk" FOREIGN KEY ("credential_type_id") REFERENCES "public"."credential_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credential_requirements" ADD CONSTRAINT "credential_requirements_provider_type_id_provider_types_id_fk" FOREIGN KEY ("provider_type_id") REFERENCES "public"."provider_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credential_requirements" ADD CONSTRAINT "credential_requirements_service_category_id_service_categories_id_fk" FOREIGN KEY ("service_category_id") REFERENCES "public"."service_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credential_requirements" ADD CONSTRAINT "credential_requirements_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_access_grants" ADD CONSTRAINT "profile_access_grants_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_access_grants" ADD CONSTRAINT "profile_access_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_credential_type_id_credential_types_id_fk" FOREIGN KEY ("credential_type_id") REFERENCES "public"."credential_types"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "watch_zones" ADD CONSTRAINT "watch_zones_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_occurrence_id_opportunity_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."opportunity_occurrences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_occurrences" ADD CONSTRAINT "booking_occurrences_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_occurrences" ADD CONSTRAINT "booking_occurrences_occurrence_id_opportunity_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."opportunity_occurrences"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "completion_records" ADD CONSTRAINT "completion_records_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_occurrences" ADD CONSTRAINT "opportunity_occurrences_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_provider_types" ADD CONSTRAINT "opportunity_provider_types_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_provider_types" ADD CONSTRAINT "opportunity_provider_types_provider_type_id_provider_types_id_fk" FOREIGN KEY ("provider_type_id") REFERENCES "public"."provider_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_services" ADD CONSTRAINT "opportunity_services_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_services" ADD CONSTRAINT "opportunity_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "threads" ADD CONSTRAINT "threads_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "threads" ADD CONSTRAINT "threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "threads" ADD CONSTRAINT "threads_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_alerts" ADD CONSTRAINT "opportunity_alerts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opportunity_alerts" ADD CONSTRAINT "opportunity_alerts_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_favorite_providers" ADD CONSTRAINT "org_favorite_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_favorite_providers" ADD CONSTRAINT "org_favorite_providers_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_provider_blocks" ADD CONSTRAINT "org_provider_blocks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_provider_blocks" ADD CONSTRAINT "org_provider_blocks_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_favorite_orgs" ADD CONSTRAINT "provider_favorite_orgs_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_favorite_orgs" ADD CONSTRAINT "provider_favorite_orgs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_org_blocks" ADD CONSTRAINT "provider_org_blocks_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_org_blocks" ADD CONSTRAINT "provider_org_blocks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_provider_profile_id_provider_profiles_id_fk" FOREIGN KEY ("provider_profile_id") REFERENCES "public"."provider_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "locations_org_idx" ON "locations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_invites_org_idx" ON "organization_invites" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_availability_provider_idx" ON "provider_availability" USING btree ("provider_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credential_documents_credential_idx" ON "credential_documents" USING btree ("provider_credential_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_items_provider_idx" ON "portfolio_items" USING btree ("provider_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profile_access_grants_unique" ON "profile_access_grants" USING btree ("provider_profile_id","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_access_grants_org_idx" ON "profile_access_grants" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_credentials_unique" ON "provider_credentials" USING btree ("provider_profile_id","credential_type_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_credentials_expiry_idx" ON "provider_credentials" USING btree ("expires_at") WHERE status in ('self_attested','document_uploaded','needs_review','admin_reviewed');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_cities_state_idx" ON "geo_cities" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geo_zips_state_idx" ON "geo_zips" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "watch_zones_provider_idx" ON "watch_zones" USING btree ("provider_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "applications_series_unique" ON "applications" USING btree ("opportunity_id","provider_profile_id") WHERE occurrence_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "applications_occurrence_unique" ON "applications" USING btree ("occurrence_id","provider_profile_id") WHERE occurrence_id is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_provider_status_idx" ON "applications" USING btree ("provider_profile_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_occurrences_occurrence_idx" ON "booking_occurrences" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_provider_idx" ON "bookings" USING btree ("provider_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_org_idx" ON "bookings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "completion_records_booking_idx" ON "completion_records" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_status_posted_idx" ON "opportunities" USING btree ("status","posted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_org_idx" ON "opportunities" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_occurrences_unique" ON "opportunity_occurrences" USING btree ("opportunity_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_occurrences_open_idx" ON "opportunity_occurrences" USING btree ("starts_at") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_participants_user_idx" ON "thread_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "threads_opportunity_provider_unique" ON "threads" USING btree ("opportunity_id","provider_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_org_idx" ON "threads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_provider_idx" ON "threads" USING btree ("provider_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_provider_msg_idx" ON "notification_deliveries" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE read_at is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_alerts_provider_idx" ON "opportunity_alerts" USING btree ("provider_profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_access_logs_provider_idx" ON "document_access_logs" USING btree ("provider_profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_booking_author_unique" ON "reviews" USING btree ("booking_id","author_kind");--> statement-breakpoint
CREATE POLICY "locations_select_public" ON "locations" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "locations_write" ON "locations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.has_org_role("locations"."organization_id", 'admin')));--> statement-breakpoint
CREATE POLICY "locations_update" ON "locations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.has_org_role("locations"."organization_id", 'admin')) or (select public.is_platform_admin())) WITH CHECK ((select public.has_org_role("locations"."organization_id", 'admin')) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "org_admin_notes_all_admin" ON "organization_admin_notes" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_platform_admin())) WITH CHECK ((select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "org_invites_select" ON "organization_invites" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.has_org_role("organization_invites"."organization_id", 'admin')) or (select public.is_platform_admin())
        or lower("organization_invites"."email") = lower(coalesce((select auth.jwt() ->> 'email'), '')));--> statement-breakpoint
CREATE POLICY "org_invites_insert" ON "organization_invites" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.has_org_role("organization_invites"."organization_id", 'admin')));--> statement-breakpoint
CREATE POLICY "org_invites_update" ON "organization_invites" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.has_org_role("organization_invites"."organization_id", 'admin'))
        or lower("organization_invites"."email") = lower(coalesce((select auth.jwt() ->> 'email'), ''))) WITH CHECK ((select public.has_org_role("organization_invites"."organization_id", 'admin'))
        or "organization_invites"."accepted_by_user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "org_invites_delete" ON "organization_invites" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.has_org_role("organization_invites"."organization_id", 'admin')));--> statement-breakpoint
CREATE POLICY "org_members_select" ON "organization_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.is_org_member("organization_members"."organization_id")) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "org_members_insert" ON "organization_members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (
        (select public.has_org_role("organization_members"."organization_id", 'admin'))
        or (
          "organization_members"."user_id" = (select auth.uid()) and "organization_members"."role" = 'owner'
          and exists (
            select 1 from organizations o
            where o.id = "organization_members"."organization_id" and o.created_by_user_id = (select auth.uid())
          )
          and not exists (
            select 1 from organization_members m where m.organization_id = "organization_members"."organization_id"
          )
        )
        or (
          "organization_members"."user_id" = (select auth.uid())
          and exists (
            select 1 from organization_invites i
            where i.organization_id = "organization_members"."organization_id"
              and lower(i.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
              and i.expires_at > now()
              and i.accepted_by_user_id is null
          )
        ));--> statement-breakpoint
CREATE POLICY "org_members_update" ON "organization_members" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.has_org_role("organization_members"."organization_id", 'admin')) or (select public.is_platform_admin())) WITH CHECK ((select public.has_org_role("organization_members"."organization_id", 'admin')) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "org_members_delete" ON "organization_members" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("organization_members"."user_id" = (select auth.uid()) or (select public.has_org_role("organization_members"."organization_id", 'admin')) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "organizations_select_public" ON "organizations" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "organizations_insert_own" ON "organizations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("organizations"."created_by_user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "organizations_update" ON "organizations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.has_org_role("organizations"."id", 'admin')) or (select public.is_platform_admin())) WITH CHECK ((select public.has_org_role("organizations"."id", 'admin')) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "profiles_select" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("profiles"."id" = (select auth.uid()) or (select public.is_platform_admin()) or exists (
        select 1 from organization_members m1
        join organization_members m2 on m2.organization_id = m1.organization_id
        where m1.user_id = (select auth.uid()) and m2.user_id = "profiles"."id"
      ));--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("profiles"."id" = (select auth.uid())) WITH CHECK ("profiles"."id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profiles_update_admin" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.is_platform_admin())) WITH CHECK ((select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "provider_types_select_all" ON "provider_types" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "service_categories_select_all" ON "service_categories" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "services_select_all" ON "services" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "provider_availability_select" ON "provider_availability" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from provider_profiles pp where pp.id = "provider_availability"."provider_profile_id"));--> statement-breakpoint
CREATE POLICY "provider_availability_write" ON "provider_availability" AS PERMISSIVE FOR ALL TO "authenticated" USING ("provider_availability"."provider_profile_id" = (select public.my_provider_profile_id())) WITH CHECK ("provider_availability"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "provider_profile_types_select" ON "provider_profile_types" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from provider_profiles pp where pp.id = "provider_profile_types"."provider_profile_id"));--> statement-breakpoint
CREATE POLICY "provider_profile_types_write" ON "provider_profile_types" AS PERMISSIVE FOR ALL TO "authenticated" USING ("provider_profile_types"."provider_profile_id" = (select public.my_provider_profile_id())) WITH CHECK ("provider_profile_types"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "provider_profiles_select" ON "provider_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("provider_profiles"."user_id" = (select auth.uid()) or (select public.is_platform_admin())
        or (not "provider_profiles"."hidden_from_search")
        or (select public.org_has_grant("provider_profiles"."id")));--> statement-breakpoint
CREATE POLICY "provider_profiles_insert_own" ON "provider_profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("provider_profiles"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "provider_profiles_update_own" ON "provider_profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("provider_profiles"."user_id" = (select auth.uid()) or (select public.is_platform_admin())) WITH CHECK ("provider_profiles"."user_id" = (select auth.uid()) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "provider_services_select" ON "provider_services" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from provider_profiles pp where pp.id = "provider_services"."provider_profile_id"));--> statement-breakpoint
CREATE POLICY "provider_services_write" ON "provider_services" AS PERMISSIVE FOR ALL TO "authenticated" USING ("provider_services"."provider_profile_id" = (select public.my_provider_profile_id())) WITH CHECK ("provider_services"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "credential_documents_select" ON "credential_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from provider_credentials pc where pc.id = "credential_documents"."provider_credential_id"));--> statement-breakpoint
CREATE POLICY "credential_documents_insert" ON "credential_documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (exists (select 1 from provider_credentials pc
        where pc.id = "credential_documents"."provider_credential_id" and pc.provider_profile_id = (select public.my_provider_profile_id())));--> statement-breakpoint
CREATE POLICY "credential_documents_delete" ON "credential_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (exists (select 1 from provider_credentials pc
        where pc.id = "credential_documents"."provider_credential_id" and pc.provider_profile_id = (select public.my_provider_profile_id())));--> statement-breakpoint
CREATE POLICY "credential_requirements_select" ON "credential_requirements" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "credential_types_select" ON "credential_types" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "portfolio_items_select" ON "portfolio_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("portfolio_items"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or (select public.org_has_grant("portfolio_items"."provider_profile_id")));--> statement-breakpoint
CREATE POLICY "portfolio_items_write" ON "portfolio_items" AS PERMISSIVE FOR ALL TO "authenticated" USING ("portfolio_items"."provider_profile_id" = (select public.my_provider_profile_id())) WITH CHECK ("portfolio_items"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "profile_access_grants_select" ON "profile_access_grants" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("profile_access_grants"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or (select public.is_org_member("profile_access_grants"."organization_id")));--> statement-breakpoint
CREATE POLICY "profile_access_grants_insert_own" ON "profile_access_grants" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("profile_access_grants"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "profile_access_grants_update_own" ON "profile_access_grants" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("profile_access_grants"."provider_profile_id" = (select public.my_provider_profile_id())) WITH CHECK ("profile_access_grants"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "provider_credentials_select" ON "provider_credentials" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("provider_credentials"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or (select public.org_has_grant("provider_credentials"."provider_profile_id")));--> statement-breakpoint
CREATE POLICY "provider_credentials_insert_own" ON "provider_credentials" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("provider_credentials"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "provider_credentials_update" ON "provider_credentials" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("provider_credentials"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())) WITH CHECK ("provider_credentials"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "provider_credentials_delete_own" ON "provider_credentials" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("provider_credentials"."provider_profile_id" = (select public.my_provider_profile_id())
        and "provider_credentials"."status" in ('not_provided', 'self_attested'));--> statement-breakpoint
CREATE POLICY "geo_cities_select" ON "geo_cities" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "geo_zips_select" ON "geo_zips" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "watch_zones_select" ON "watch_zones" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("watch_zones"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "watch_zones_write" ON "watch_zones" AS PERMISSIVE FOR ALL TO "authenticated" USING ("watch_zones"."provider_profile_id" = (select public.my_provider_profile_id())) WITH CHECK ("watch_zones"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "applications_select" ON "applications" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("applications"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or exists (select 1 from opportunities o where o.id = "applications"."opportunity_id"
             and (select public.is_org_member(o.organization_id))));--> statement-breakpoint
CREATE POLICY "applications_insert" ON "applications" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("applications"."provider_profile_id" = (select public.my_provider_profile_id())
        and exists (select 1 from opportunities o
              where o.id = "applications"."opportunity_id" and o.status = 'posted'));--> statement-breakpoint
CREATE POLICY "applications_update" ON "applications" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("applications"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or exists (select 1 from opportunities o where o.id = "applications"."opportunity_id"
             and (select public.has_org_role(o.organization_id, 'poster')))) WITH CHECK ("applications"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or exists (select 1 from opportunities o where o.id = "applications"."opportunity_id"
             and (select public.has_org_role(o.organization_id, 'poster'))));--> statement-breakpoint
CREATE POLICY "booking_occurrences_select" ON "booking_occurrences" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from bookings b where b.id = "booking_occurrences"."booking_id"));--> statement-breakpoint
CREATE POLICY "booking_occurrences_write" ON "booking_occurrences" AS PERMISSIVE FOR ALL TO "authenticated" USING (exists (select 1 from bookings b where b.id = "booking_occurrences"."booking_id"
        and (b.provider_profile_id = (select public.my_provider_profile_id())
             or (select public.has_org_role(b.organization_id, 'poster'))))) WITH CHECK (exists (select 1 from bookings b where b.id = "booking_occurrences"."booking_id"
        and (b.provider_profile_id = (select public.my_provider_profile_id())
             or (select public.has_org_role(b.organization_id, 'poster')))));--> statement-breakpoint
CREATE POLICY "bookings_select" ON "bookings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("bookings"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or (select public.is_org_member("bookings"."organization_id")));--> statement-breakpoint
CREATE POLICY "bookings_insert" ON "bookings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.has_org_role("bookings"."organization_id", 'poster')));--> statement-breakpoint
CREATE POLICY "bookings_update" ON "bookings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("bookings"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or (select public.has_org_role("bookings"."organization_id", 'poster'))) WITH CHECK ("bookings"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or (select public.has_org_role("bookings"."organization_id", 'poster')));--> statement-breakpoint
CREATE POLICY "completion_records_select" ON "completion_records" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from bookings b where b.id = "completion_records"."booking_id"));--> statement-breakpoint
CREATE POLICY "completion_records_insert" ON "completion_records" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (exists (select 1 from bookings b where b.id = "completion_records"."booking_id"
        and (select public.has_org_role(b.organization_id, 'poster'))));--> statement-breakpoint
CREATE POLICY "completion_records_update" ON "completion_records" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (exists (select 1 from bookings b where b.id = "completion_records"."booking_id"
        and (b.provider_profile_id = (select public.my_provider_profile_id())
             or (select public.has_org_role(b.organization_id, 'poster')))) or (select public.is_platform_admin())) WITH CHECK (exists (select 1 from bookings b where b.id = "completion_records"."booking_id"
        and (b.provider_profile_id = (select public.my_provider_profile_id())
             or (select public.has_org_role(b.organization_id, 'poster')))) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "opportunities_select" ON "opportunities" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ("opportunities"."status" = 'posted'
        or (select public.is_org_member("opportunities"."organization_id"))
        or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "opportunities_insert" ON "opportunities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.has_org_role("opportunities"."organization_id", 'poster'))
        and "opportunities"."posted_by_user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "opportunities_update" ON "opportunities" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.has_org_role("opportunities"."organization_id", 'poster')) or (select public.is_platform_admin())) WITH CHECK ((select public.has_org_role("opportunities"."organization_id", 'poster')) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "opportunity_occurrences_select" ON "opportunity_occurrences" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (exists (select 1 from opportunities o where o.id = "opportunity_occurrences"."opportunity_id"));--> statement-breakpoint
CREATE POLICY "opportunity_occurrences_write" ON "opportunity_occurrences" AS PERMISSIVE FOR ALL TO "authenticated" USING (exists (select 1 from opportunities o where o.id = "opportunity_occurrences"."opportunity_id"
        and (select public.has_org_role(o.organization_id, 'poster')))) WITH CHECK (exists (select 1 from opportunities o where o.id = "opportunity_occurrences"."opportunity_id"
        and (select public.has_org_role(o.organization_id, 'poster'))));--> statement-breakpoint
CREATE POLICY "opportunity_provider_types_select" ON "opportunity_provider_types" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (exists (select 1 from opportunities o where o.id = "opportunity_provider_types"."opportunity_id"));--> statement-breakpoint
CREATE POLICY "opportunity_provider_types_write" ON "opportunity_provider_types" AS PERMISSIVE FOR ALL TO "authenticated" USING (exists (select 1 from opportunities o where o.id = "opportunity_provider_types"."opportunity_id"
        and (select public.has_org_role(o.organization_id, 'poster')))) WITH CHECK (exists (select 1 from opportunities o where o.id = "opportunity_provider_types"."opportunity_id"
        and (select public.has_org_role(o.organization_id, 'poster'))));--> statement-breakpoint
CREATE POLICY "opportunity_services_select" ON "opportunity_services" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (exists (select 1 from opportunities o where o.id = "opportunity_services"."opportunity_id"));--> statement-breakpoint
CREATE POLICY "opportunity_services_write" ON "opportunity_services" AS PERMISSIVE FOR ALL TO "authenticated" USING (exists (select 1 from opportunities o where o.id = "opportunity_services"."opportunity_id"
        and (select public.has_org_role(o.organization_id, 'poster')))) WITH CHECK (exists (select 1 from opportunities o where o.id = "opportunity_services"."opportunity_id"
        and (select public.has_org_role(o.organization_id, 'poster'))));--> statement-breakpoint
CREATE POLICY "messages_select" ON "messages" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.is_thread_participant("messages"."thread_id")) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "messages_insert" ON "messages" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("messages"."sender_user_id" = (select auth.uid())
        and (select public.is_thread_participant("messages"."thread_id"))
        and exists (select 1 from threads t where t.id = "messages"."thread_id" and t.locked_at is null));--> statement-breakpoint
CREATE POLICY "thread_participants_select" ON "thread_participants" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from threads t where t.id = "thread_participants"."thread_id"));--> statement-breakpoint
CREATE POLICY "thread_participants_insert_self" ON "thread_participants" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("thread_participants"."user_id" = (select auth.uid())
        and exists (select 1 from threads t where t.id = "thread_participants"."thread_id"));--> statement-breakpoint
CREATE POLICY "thread_participants_update_self" ON "thread_participants" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("thread_participants"."user_id" = (select auth.uid())) WITH CHECK ("thread_participants"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "threads_select" ON "threads" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("threads"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or (select public.is_org_member("threads"."organization_id")));--> statement-breakpoint
CREATE POLICY "threads_insert" ON "threads" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("threads"."provider_profile_id" = (select public.my_provider_profile_id())
        or (select public.has_org_role("threads"."organization_id", 'poster')));--> statement-breakpoint
CREATE POLICY "threads_update" ON "threads" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("threads"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or (select public.is_org_member("threads"."organization_id"))) WITH CHECK ("threads"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin())
        or (select public.is_org_member("threads"."organization_id")));--> statement-breakpoint
CREATE POLICY "notification_deliveries_select" ON "notification_deliveries" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from notifications n where n.id = "notification_deliveries"."notification_id") or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "notification_preferences_all_own" ON "notification_preferences" AS PERMISSIVE FOR ALL TO "authenticated" USING ("notification_preferences"."user_id" = (select auth.uid())) WITH CHECK ("notification_preferences"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "notifications_select_own" ON "notifications" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("notifications"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "notifications_update_own" ON "notifications" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("notifications"."user_id" = (select auth.uid())) WITH CHECK ("notifications"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "notifications_delete_own" ON "notifications" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("notifications"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "opportunity_alerts_select" ON "opportunity_alerts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("opportunity_alerts"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "sms_consent_log_select" ON "sms_consent_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("sms_consent_log"."user_id" = (select auth.uid()) or (select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "sms_consent_log_insert_own" ON "sms_consent_log" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("sms_consent_log"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "org_favorite_providers_all" ON "org_favorite_providers" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.has_org_role("org_favorite_providers"."organization_id", 'poster'))) WITH CHECK ((select public.has_org_role("org_favorite_providers"."organization_id", 'poster')));--> statement-breakpoint
CREATE POLICY "org_provider_blocks_all" ON "org_provider_blocks" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.has_org_role("org_provider_blocks"."organization_id", 'poster'))) WITH CHECK ((select public.has_org_role("org_provider_blocks"."organization_id", 'poster')));--> statement-breakpoint
CREATE POLICY "provider_favorite_orgs_all" ON "provider_favorite_orgs" AS PERMISSIVE FOR ALL TO "authenticated" USING ("provider_favorite_orgs"."provider_profile_id" = (select public.my_provider_profile_id())) WITH CHECK ("provider_favorite_orgs"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "provider_org_blocks_all" ON "provider_org_blocks" AS PERMISSIVE FOR ALL TO "authenticated" USING ("provider_org_blocks"."provider_profile_id" = (select public.my_provider_profile_id())) WITH CHECK ("provider_org_blocks"."provider_profile_id" = (select public.my_provider_profile_id()));--> statement-breakpoint
CREATE POLICY "audit_logs_select_admin" ON "audit_logs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.is_platform_admin()));--> statement-breakpoint
CREATE POLICY "document_access_logs_select" ON "document_access_logs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("document_access_logs"."provider_profile_id" = (select public.my_provider_profile_id()) or (select public.is_platform_admin()));