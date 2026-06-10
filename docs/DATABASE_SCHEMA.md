# DATABASE_SCHEMA

Proposed schema for the MVP. Conventions: all timestamps `timestamptz`; all money integer **cents**; PKs `uuid` (`gen_random_uuid()`) except append-only logs (`bigint identity`); geography columns `geography(..., 4326)`; tables defined in Drizzle with `pgPolicy` RLS in the same file; GIST/GIN indexes and role grants in manual SQL migrations (NotifEyes pattern). RLS is enabled on **every** table — deny by default.

## Enums

```
org_member_role:        owner | admin | poster
opportunity_type:       one_time_shift | recurring_shift | part_time | full_time | contract |
                        popup_event | training_event | room_rental | evergreen
                        -- training_event / room_rental / evergreen exist in the enum now;
                        -- training_event & room_rental are UI-gated "coming soon" in MVP
opportunity_status:     draft | posted | filled | expired | canceled | archived
occurrence_status:      open | booked | completed | canceled
pay_kind:               fixed | range | negotiable_min
pay_unit:               hour | day | per_treatment | commission_pct | salary_year | flat
application_scope:      series | occurrence
application_status:     submitted | viewed | shortlisted | offered | accepted | declined |
                        withdrawn | expired
booking_scope:          series | occurrences
booking_status:         confirmed | completed | canceled_by_provider | canceled_by_business |
                        canceled_by_admin | no_show_provider | no_show_business | disputed
credential_status:      not_provided | self_attested | document_uploaded | needs_review |
                        admin_reviewed | rejected_needs_info
requirement_level:      required | recommended
watch_zone_kind:        radius | polygon | city | zip
match_grade:            exact | close
notification_channel:   in_app | email | sms
delivery_status:        queued | sent | delivered | failed | bounced | suppressed
completion_status:      pending | confirmed | disputed | voided
notification_category:  watch_match | application_activity | booking_activity | messages |
                        credentials | reminders | admin | marketing
```

**`expiring_soon` / `expired` are derived, never stored** — computed from `provider_credentials.expires_at` (`expired: expires_at < now()`, `expiring_soon: within 30 days`) via a view/computed expression, so the stored status can't lie after a date passes.

---

## 1. Identity, roles, organizations

### `profiles` — 1:1 with `auth.users` (id = auth.users.id)
`id uuid PK` · `full_name` · `phone_e164 text null` · `phone_verified_at` · `timezone text not null default 'America/New_York'` (IANA) · `avatar_path` · `is_platform_admin bool default false` · `suspended_at` · `suspended_reason` · `email_opted_in bool default true` · `sms_opted_in bool default false` · `sms_opt_out_at` · `created_at`

Created by a trigger on `auth.users` insert. Email lives in `auth.users`.

### `organizations`
`id` · `name` · `slug unique` (public SEO slug where appropriate) · `kind text` (med_spa | spa | salon | derm_practice | plastic_surgery | wellness_clinic | massage_studio | makeup_event_co | training_center | other) · `description` · `website` · `phone` · `logo_path` · `software_emr_pos text null` · `internal_notes text` (admin-only) · `admin_flags jsonb default '{}'` · `verified_at` · `created_by_user_id FK profiles` · `stripe_customer_id text null` *(future; unused in MVP)* · `created_at`

### `organization_members`
`(organization_id FK, user_id FK profiles) PK` · `role org_member_role` · `title text null` · `invited_by_user_id` · `accepted_at` · `created_at`

Role ladder: `owner` ⊃ `admin` (manage members, locations, org profile) ⊃ `poster` (create/manage opportunities, message applicants).

### `organization_invites`
`id` · `organization_id FK` · `email` · `role org_member_role` · `token_hash` · `invited_by_user_id` · `expires_at` · `accepted_by_user_id null` · `created_at`

### `locations`
`id` · `organization_id FK` · `name` · `address_line1/2` · `city` · `state char(2)` · `zip` · `geog geography(Point)` · `timezone text not null` (IANA, set at geocode time) · `phone` · `parking_notes` · `dress_code` · `supervision_context text null` (e.g., medical-director arrangement as *described by the business*) · `equipment jsonb default '[]'` · `products_brands jsonb default '[]'` · `photos jsonb default '[]'` (org-media paths) · `active bool` · `created_at`

---

## 2. Taxonomy (seeded lookup tables, not enums — they drive SEO pages and credential requirements)

### `provider_types`
`id` · `slug unique` · `name` · `requires_state_license bool` · `sort` · `active`

Seed: `injector_rn`, `injector_np` (APRN/NP), `injector_pa`, `injector_md_do`, `aesthetician`, `laser_technician`, `massage_therapist`, `makeup_artist`, `wellness_provider`.

### `service_categories`
`id` · `slug unique` · `name` · `risk_tier smallint default 1` (1 low … 3 high; drives credential-review prioritization and UI flagging) · `sort` · `active`

Seed: injectables (3), laser (3), skincare/facials (1), massage (2), makeup (1), wellness/IV (3), waxing/brows-lashes (1), …

### `services`
`id` · `category_id FK` · `slug unique` · `name` · `sort` · `active`

Seed examples: botox/neurotoxin, dermal filler, lip filler, chemical peel, hydrafacial, dermaplaning, microneedling, laser hair removal, IPL, CO2 resurfacing, swedish massage, deep tissue, bridal makeup, IV hydration, b12 injections, …

---

## 3. Provider profiles & credentials

### `provider_profiles` — 0..1 per user
`id` · `user_id FK profiles unique` · `slug unique` (unguessable random suffix — profiles are never indexed) · `display_name` · `bio` · `headshot_path null` · `home_location geography(Point) null` · `home_city` · `home_state char(2)` · `home_zip` · `travel_radius_m int null` · `years_experience smallint null` · `pay_min_cents int null` + `pay_min_unit pay_unit null` (default pay floor; per-zone floors override) · `pay_structures_accepted pay_unit[] default '{}'` · `urgent_available bool default false` · `available_now_status text null` (today | this_week | null) + `available_now_set_at` (auto-expires) · `social_handles jsonb default '{}'` · `hidden_from_search bool default false` · `onboarding_status text` · `current_employer_private text null` (**never displayed**; optional self-record only) · `stripe_account_id text null` *(future)* · `created_at`

### `provider_profile_types`
`(provider_profile_id, provider_type_id) PK` · `is_primary bool`

### `provider_services`
`(provider_profile_id, service_id) PK` · `years_experience smallint null` (optional per-service experience)

### `provider_availability`
`id` · `provider_profile_id FK` · `day_of_week smallint (0–6)` · `time_start time` · `time_end time` (interpreted in the **opportunity location's** timezone at match time) · `note text null`

Simple weekly template for MVP; calendar-grade availability is V2.

### `credential_types`
`id` · `slug unique` · `name` · `description` · `requires_document bool` · `requires_expiry bool` · `requires_license_number bool` · `active`

Seed: `rn_license`, `aprn_license`, `pa_license`, `md_do_license`, `esthetician_license`, `master_cosmetologist_license`, `lmt_license`, `cpr_bls`, `liability_insurance`, `botox_training_cert`, `filler_training_cert`, `laser_cert`, `iv_certification`, …

### `credential_requirements` — the rules engine (data, not code)
`id` · `credential_type_id FK` · `provider_type_id FK null` · `service_category_id FK null` · `service_id FK null` · `state char(2) null` (null = all states) · `level requirement_level` · `active` · `notes`
`CHECK (provider_type_id IS NOT NULL OR service_category_id IS NOT NULL OR service_id IS NOT NULL)`

**Semantics:** the requirements applicable to a provider/opportunity = the **union** of rows matching its provider type(s) ∪ its services' categories ∪ its specific services, intersected with `state IN (location.state, NULL)`. Drives warning chips and the admin queue. Georgia seed rows must be validated against actual GA rules before launch (see COMPLIANCE_AND_TRUST + OPEN_QUESTIONS).

### `provider_credentials`
`id` · `provider_profile_id FK` · `credential_type_id FK` · `state char(2) null` · `status credential_status default 'not_provided'` · `license_number text null` · `issuing_board text null` · `issued_at date null` · `expires_at date null` · `self_attested_at` · `submitted_for_review_at` · `reviewed_by_user_id null` · `reviewed_at` · `review_notes` · `rejection_reason` · `created_at`
`UNIQUE (provider_profile_id, credential_type_id, state)`

Status flow: `not_provided → self_attested → document_uploaded → needs_review → admin_reviewed | rejected_needs_info`. A trigger (or column-grant split) prevents non-admins from setting `admin_reviewed`/`rejected_needs_info` or `reviewed_*` columns.

### `credential_documents`
`id` · `provider_credential_id FK` · `storage_path text` (**path, never URL**; bucket `credentials`, prefix `auth.uid()/`) · `file_name` · `mime_type` · `size_bytes` · `uploaded_at`

### `portfolio_items`
`id` · `provider_profile_id FK` · `storage_path` (bucket `portfolios`) · `caption` · `service_id null` · `consent_attested_at timestamptz not null` (provider attests rights/consent at upload) · `sort` · `created_at`

### `profile_access_grants` — the single privacy gate for credentials + portfolios
`id` · `provider_profile_id FK` · `organization_id FK` · `granted_via text` (application | manual) · `application_id null` · `granted_at` · `revoked_at null`
`UNIQUE (provider_profile_id, organization_id)`

Auto-inserted when a provider applies to an org's opportunity; provider can also grant manually and revoke. Implements "portfolio visible only to businesses the provider applies to or explicitly approves."

---

## 4. Watch zones & geo reference

### `watch_zones`
`id` · `provider_profile_id FK` · `name` · `kind watch_zone_kind` · `geom geography(Geometry) not null` (**always materialized** — radius via `ST_Buffer`, polygon via WKT, city/zip copied from reference polygons at save time) · `geometry_meta jsonb` (discriminated union: `{kind:'radius',centerLat,centerLng,radiusMeters}` | `{kind:'polygon',points:[…]}` | `{kind:'city',placeGeoid,name,state}` | `{kind:'zip',zip}` — keeps source for UI re-render + re-materialization; `fallback:true` flag when centroid+buffer was used) · `opportunity_types opportunity_type[] default '{}'` (empty = all) · `service_ids uuid[] default '{}'` (empty = all my services) · `min_pay_cents int null` · `min_pay_unit pay_unit default 'hour'` · `days_of_week smallint[] default '{0,1,2,3,4,5,6}'` · `time_start_local time null` · `time_end_local time null` · `urgent_only bool default false` · `alert_grades match_grade[] default '{exact,close}'` (exact-only vs exact+close preference, per zone) · `channel_in_app bool default true` · `channel_email bool default true` · `channel_sms bool default false` · `paused bool default false` · `created_at`

### `geo_zips`
`zip char(5) PK` · `state char(2)` · `city` · `geog geography(MultiPolygon)` — Census ZCTA polygons; **Georgia loaded first**.

### `geo_cities`
`geoid text PK` · `name` · `state char(2)` · `geog geography(MultiPolygon)` — Census "places."

---

## 5. Opportunities, occurrences, applications, bookings

### `opportunities` — the parent posting
`id` · `organization_id FK` · `location_id FK` · `posted_by_user_id FK` · `type opportunity_type` · `title` · `description` · `provider notes` fields: `expected_volume text null` · `liability_expectations text null` · `notes text null` ·
Pay: `pay_kind pay_kind null` · `pay_unit pay_unit null` · `pay_min_cents int null` · `pay_max_cents int null` ·
Schedule: `recurrence_rule text null` (RFC 5545 RRULE) · `recurrence_local_start time null` · `recurrence_duration_min int null` · `recurrence_until date null` · `timezone text` (denormalized from location) ·
Flags/lifecycle: `urgent bool default false` · `slot_count smallint default 1` · `required_provider_type_note text null` · `application_deadline timestamptz null` · `expires_at timestamptz null` (auto-expiration) · `status opportunity_status default 'draft'` · `posted_at` · `filled_at` · `created_at`

**Pay-visibility CHECK** (the no-hidden-pay rule, enforced in the database):
```sql
CHECK (
  type NOT IN ('one_time_shift','recurring_shift','popup_event','contract')
  OR (pay_kind IS NOT NULL AND pay_min_cents IS NOT NULL AND pay_unit IS NOT NULL)
)
-- fixed: pay_max_cents = pay_min_cents
-- range: pay_max_cents > pay_min_cents
-- negotiable_min: pay_max_cents IS NULL (minimum is shown)
```
No bidding tables exist anywhere; applications carry no rate field — providers' asking rates are structurally invisible to other providers.

### `opportunity_services` — `(opportunity_id, service_id) PK`
### `opportunity_provider_types` — `(opportunity_id, provider_type_id) PK` · `license_required_note text null`

### `opportunity_occurrences`
`id` · `opportunity_id FK` · `starts_at timestamptz` · `ends_at timestamptz` · `status occurrence_status default 'open'` · `rescheduled_from_id uuid null` · `created_at`
`UNIQUE (opportunity_id, starts_at)`

**Every opportunity with concrete times gets occurrences — a one-time shift gets exactly one row.** Part-time/full-time/contract/evergreen may have zero. One uniform model for applications, bookings, reminders, and completion. The `generate-occurrences` cron expands RRULEs on a rolling 8-week window, in the location's IANA timezone (DST resolved exactly once, at generation).

### `applications`
`id` · `opportunity_id FK` · `occurrence_id FK null` · `provider_profile_id FK` · `scope application_scope` · `status application_status default 'submitted'` · `message text null` · `source text` (search | watch_alert | invite) · `watch_zone_id null` · `created_at` · `status_changed_at`

Partial uniques: `UNIQUE(opportunity_id, provider_profile_id) WHERE occurrence_id IS NULL` and `UNIQUE(occurrence_id, provider_profile_id) WHERE occurrence_id IS NOT NULL`.
State machine (NotifEyes `assertTransition` pattern): `submitted → viewed → shortlisted → offered → accepted`, with `declined/withdrawn/expired` exits; direct `submitted → offered/accepted` allowed (low-friction selection); `invite` source starts at `offered`.

### `bookings`
`id` · `opportunity_id FK` · `application_id FK` · `provider_profile_id FK` · `organization_id FK` (denorm) · `location_id FK` (denorm) · `scope booking_scope` · `status booking_status default 'confirmed'` · `provider_confirmed_at` · `business_confirmed_at` · `terms_version text` + `terms_accepted_provider_at` + `terms_accepted_business_at` (click-through boilerplate; frozen body via versioned template — NotifEyes contract pattern) · `canceled_at` · `canceled_by_user_id` · `cancellation_reason` · `admin_notes text null` · `created_at`

A booking exists once both sides confirm. Series acceptance → `scope='series'` + `booking_occurrences` rows for all existing occurrences (cron extends to future ones). Specific dates → `scope='occurrences'` + rows for chosen dates only.

### `booking_occurrences`
`(booking_id, occurrence_id) PK` · `status booking_status default 'confirmed'` · `completed_at` · `canceled_at` · `cancellation_reason` · `no_show_reported_by_user_id null` · `admin_notes`

Per-date cancellations/no-shows/disputes live here; series-level status on `bookings`. **Stress case the model handles:** one recurring post with `slot_count 2` can hold booking A (provider A, Mondays) and booking B (provider B, Wednesdays) simultaneously — occurrence `status='booked'` only when its booked count reaches `slot_count`.

### `completion_records` — invoice-ready, zero processing
`id` · `booking_id FK` · `occurrence_id null` · `amount_cents` · `pay_unit` · `units_worked numeric null` · `line_items jsonb default '[]'` · `status completion_status default 'pending'` · `confirmed_by_user_id` · `confirmed_at` · `invoice_number text null` · `stripe_payment_intent_id text null` *(future)* · `stripe_invoice_id text null` *(future)* · `notes` · `created_at`

---

## 6. Messaging

### `threads`
`id` · `opportunity_id FK not null` (**always context-bound**) · `organization_id FK` · `provider_profile_id FK` · `application_id null` · `booking_id null` · `contact_revealed_at timestamptz null` (set when booking confirmed) · `locked_at null` (admin lock) · `last_message_at` · `created_at`
`UNIQUE (opportunity_id, provider_profile_id)`

### `thread_participants`
`(thread_id, user_id) PK` · `last_read_at` · `unread_count int default 0`
Org members with opportunity access join lazily on first view.

### `messages`
`id` · `thread_id FK` · `sender_user_id FK null` (null = system) · `body text` · `attachments jsonb default '[]'` · `contact_flagged bool default false` (regex-detected phone/email **before** `contact_revealed_at` — warn + flag for admin, don't silently drop) · `system_kind text null` · `system_payload jsonb null` · `created_at`

Patient-information warning rendered above the composer; prohibition in ToS; admin review possible because admins can read threads (logged via audit).

---

## 7. Matching & notifications

### `opportunity_alerts` — the dedup ledger
`(opportunity_id, provider_profile_id) PK` · `watch_zone_id FK` (best/first matching zone) · `match_grade match_grade` · `score jsonb` (per-criterion verdicts, for debugging/tuning) · `matched_at` · `notification_id null` · `realerted_at null`

Insert with `ON CONFLICT DO NOTHING`; only a successful insert dispatches. Max one re-alert (`WHERE realerted_at IS NULL`) on material improvement.

### `notifications`
`id` · `user_id FK` · `kind varchar(40)` (new_exact_match | new_close_match | urgent_opportunity | application_received | application_selected | provider_confirmed | business_confirmed | booking_canceled | booking_reminder | credential_expiring | credential_expired | credential_reviewed | admin_action_needed | message_received | …) · `title` · `body` · `payload jsonb` · `action_url` · `read_at null` · `created_at`

### `notification_deliveries` — per-channel compliance log
`id bigint identity` · `notification_id FK` · `channel notification_channel` · `recipient text` (email or E.164) · `status delivery_status default 'queued'` · `provider_message_id text null` (Resend id / Twilio SID) · `error text` · `queued_at` · `sent_at` · `delivered_at` · `failed_at`

Webhook-updated (Resend events, Twilio status callbacks). Bounce → future sends `suppressed`.

### `notification_preferences`
`(user_id, category notification_category) PK` · `in_app bool` · `email bool` · `sms bool`
Transactional safety/admin notices ignore preferences. Watch-zone channel toggles further narrow `watch_match` per zone.

### `sms_consent_log` — TCPA audit trail
`id bigint identity` · `user_id null` · `phone_e164` · `action text` (opt_in | opt_out | help) · `source text` (signup | keyword | admin) · `raw_message text null` · `occurred_at`

---

## 8. Favorites, blocks, audit, future tables

### Favorites & blocks (all simple junction tables)
`org_favorite_providers (organization_id, provider_profile_id) PK` · `provider_favorite_orgs (provider_profile_id, organization_id) PK` · `provider_org_blocks` and `org_provider_blocks` (same shape; both excluded from matching — NotifEyes blocklist pattern).

### `audit_logs` — append-only
`id bigint identity` · `actor_user_id null` · `acting_as text` (provider | org_member | admin | system) · `organization_id null` · `action text` (e.g., `credential.reviewed`, `booking.canceled`, `member.invited`, `post.removed`, `user.suspended`) · `entity_type text` · `entity_id uuid` · `changes jsonb` (before/after diff) · `ip inet null` · `user_agent text null` · `created_at`

INSERT only via `record_audit()` `SECURITY DEFINER` function; all DML revoked from `authenticated`.

### `document_access_logs`
`id bigint identity` · `accessor_user_id FK` · `organization_id null` · `provider_profile_id FK` · `document_kind text` (credential | portfolio) · `document_id uuid` · `access_kind text` (signed_url_issued | admin_view) · `created_at`

Providers can read rows about their own documents (transparency feature).

### `reviews` — created now, **deny-all RLS, no UI** (future-ready)
`id` · `booking_id FK` · `author_kind text` (provider | business) · `author_user_id` · `rating smallint` · `body` · `published_at null` · `created_at`
`UNIQUE (booking_id, author_kind)`

### Payment readiness (columns only, no tables to migrate later)
`organizations.stripe_customer_id` · `provider_profiles.stripe_account_id` · `completion_records.stripe_payment_intent_id/stripe_invoice_id` — all nullable, all unused in MVP. Future booking fees/subscriptions get their own tables when designed; nothing in MVP blocks them.

---

## 9. Index plan

**GIST (manual migration):** `watch_zones(geom)` · `locations(geog)` · `geo_zips(geog)` · `geo_cities(geog)` · `provider_profiles(home_location)`

**GIN:** `watch_zones(opportunity_types)` · `watch_zones(service_ids)` (array-overlap prefilter)

**B-tree / partial:**
- `opportunity_occurrences(opportunity_id, starts_at)`; partial `(starts_at) WHERE status='open'`
- `opportunities(status, posted_at)`; `opportunities(organization_id)`; partial `(expires_at) WHERE status='posted'`
- the two partial uniques on `applications`; `applications(provider_profile_id, status)`
- `bookings(provider_profile_id)`, `bookings(organization_id)`; `booking_occurrences(occurrence_id)`
- `notifications(user_id, created_at DESC)`; partial `(user_id) WHERE read_at IS NULL` (the polling query)
- `notification_deliveries(provider_message_id)` (webhook lookups); `(status, queued_at)` (retry scans)
- partial `provider_credentials(expires_at) WHERE status IN ('self_attested','document_uploaded','needs_review','admin_reviewed')` (expiry cron)
- `audit_logs(entity_type, entity_id)`; `audit_logs(actor_user_id, created_at)`
- `organization_members(user_id)`; `threads(provider_profile_id)`, `threads(organization_id)`; `messages(thread_id, created_at)`
- `profile_access_grants(organization_id)` (the credential-visibility policy join)

---

## 10. RLS policy matrix (sensitive tables)

Helpers (all `STABLE SECURITY DEFINER`, wrapped as `(select …)` in policies): `is_platform_admin()` · `is_org_member(org_id)` · `has_org_role(org_id, min)` · `my_provider_profile_id()` (`pp` below) · `org_has_grant(provider_profile_id)` ≡ exists unrevoked `profile_access_grants` row for one of my orgs.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `provider_credentials` | owner (`provider_profile_id = pp`); admin; org member where `org_has_grant(...)` | owner | owner — but review columns/statuses protected by trigger; admin path sets `admin_reviewed`/`rejected_needs_info` | owner while status in (`not_provided`,`self_attested`) |
| `credential_documents` | same as parent credential | owner | none (replace = delete + insert) | owner |
| `portfolio_items` | owner; admin; org member via `org_has_grant` | owner | owner | owner |
| `profile_access_grants` | owner provider; the granted org's members; admin | server action on application; owner (manual grant) | owner (revoke: set `revoked_at`) | none |
| `messages` | thread participant (`exists` on `thread_participants`) | participant AND thread not locked | none | none |
| `threads` | participant; org members of `organization_id`; admin | server action only | none | none |
| `applications` | owner provider; members of the opportunity's org; admin | provider for self, opportunity `status='posted'` | provider (withdraw only); org member (status transitions); transitions asserted app-side | none |
| `watch_zones` | owner; admin | owner | owner | owner |
| `notifications` / `notification_preferences` | `user_id = auth.uid()` | server/system | own (`read_at`, prefs) | own |
| `opportunities` | anyone when `status='posted'` (public detail + SEO); org members all statuses; admin | org member with role ≥ poster | same | none (cancel/archive via status) |
| `provider_profiles` | owner; admin; authenticated business members **unless** `hidden_from_search` (and never anonymous) | owner | owner | none |
| `audit_logs` | admin only | nobody — `record_audit()` definer fn only | none | none |
| `document_access_logs` | admin; provider for rows about own docs | server only | none | none |
| `reviews` | **deny all** except own-unpublished (future) | none in MVP | none | none |
| `geo_*`, taxonomies | all authenticated (+ anon for taxonomies powering SEO) | admin/seed only | admin | admin |

Storage policies: `credentials`/`portfolios` buckets — owner path-prefix read/write only; **all** third-party access via server-issued 5-minute signed URLs + `document_access_logs` row. `org-media`/`avatars` public-read.

---

## 11. Timezone rules

- Every concrete instant: `timestamptz` (occurrences, confirmations, deadlines, logs).
- Local wall-clock times exist in exactly two places: recurrence templates (`recurrence_local_start` + `locations.timezone`) and watch-zone/availability time filters (`time` columns, interpreted in the **opportunity location's** timezone at match time — the work happens there).
- RRULE expansion happens once, at occurrence generation, in the location's IANA zone → `timestamptz` instants. DST is resolved at generation, never at read time.
- Display: render in the location's timezone with the zone abbreviation; Georgia launch makes this nearly invisible (all ET), but the model is multi-state-correct from day one.

## 12. Schema-level future-proofing summary

| Future feature | Already in schema | Still needed later |
|---|---|---|
| Stripe payments | Nullable Stripe IDs on orgs/providers/completion_records; completion records as invoice basis | Fee/subscription tables, webhook handlers, payout flows |
| Reviews | `reviews` table + unique constraints, deny-all RLS | Policies, aggregates, UI, blind-publish job |
| Training events / room rental | Enum values; opportunities model fits both | Type-specific fields/UI when prioritized |
| More states | `state` columns on credentials/requirements; geo reference tables load per state | Data loads + GA-equivalent legal review per state |
| Native mobile + push | Channel enum extensible; deliveries table channel-agnostic | `push` adapter + device-token table |
| Hard credential blocking | `credential_requirements.level` + risk tiers | A `blocking` level + enforcement at apply/post time |
| Check-in/out | `booking_occurrences` is the natural host | Timestamp columns + UI |
