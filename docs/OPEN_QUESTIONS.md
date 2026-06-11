# OPEN_QUESTIONS

Organized by what blocks coding vs. what can be decided later. Where a default is proposed, coding proceeds with the default unless overridden.

## Decisions log (append-only)

- **2026-06-11 — Phase 7 shipped (applications & bookings).** Apply flow on `/o/[id]` for
  signed-in providers: whole-series or specific-dates scope (one row per date, the partial
  uniques dedup), optional message, **credential chips frozen onto the application**
  (`applications.credential_snapshot jsonb` — schema addition vs DATABASE_SCHEMA.md, implementing
  the documented snapshot requirement) via a new opportunity-scoped requirements summary
  (`getOpportunityCredentialChips`); applying upserts `profile_access_grants` (a revoked grant
  reopens on re-apply) and auto-detects `watch_alert` source from the alerts ledger. Applicant
  review at `/b/opportunities/[id]/applicants` grouped per provider (snapshot chips, message,
  shortlist/offer/decline on the whole candidacy); `/b/providers/[id]` profile view (basics for
  any business member; credentials + portfolio only with a grant; **pay floors never selected**);
  `/api/files/sign` is the logged third-party signing path (RLS authorizes via the caller's own
  view, `record_document_access` writes the audit row, service-role storage client signs 5-min
  URLs — returns 503 until `SUPABASE_SERVICE_ROLE_KEY` lands in `.env`, founder errand open).
  **Dual confirmation maps to the offer/accept pair**: the business's terms click-through happens
  at offer time (its `status_changed_at` becomes `business_confirmed_at`/`terms_accepted_business_at`),
  the provider's at accept — the accept action creates the booking, so a `bookings` row existing
  IS the both-sides-confirmed state (no pending booking status needed). New RLS paths:
  `bookings_insert` now admits the provider holding an offered/accepted application (with the
  denorm org/location pinned to the opportunity row); `profiles_select` gains
  `org_has_confirmed_booking_with()` so **contact reveals only once a booking exists** (the
  booking row is the gate; email comes from `booking_counterparty_email()`, a definer that hands
  each party exactly their counterparty's address). Occurrence open↔booked is a SECURITY DEFINER
  trigger (`drizzle/manual/0006`) recounting confirmed `booking_occurrences` vs `slot_count` —
  the two writers sit on opposite sides of RLS — with a hard overbooking stop (the FOR UPDATE
  serializes racing accepts; the loser errors) and future-only reopening on cancellation.
  Worker: new `notify-event` queue; server actions enqueue lifecycle events
  (received/withdrawn/offered/declined/confirmed/canceled/no-show/disputed/completion) and
  `src/workers/jobs/events.ts` dispatches with the service role, deduped per (user, kind,
  eventKey) so retries never double-send; `booking_confirmed` also expires competing applications
  on filled dates, flips the opportunity to `filled` when nothing open remains, and notifies the
  losers once per opportunity. Booking pages both sides (lists + detail: cancel series/date with
  reason, report/dispute no-show, business completes ended dates → editable-units
  `completion_records`, provider confirms/disputes). State machines: `application.ts` +
  `booking.ts` per the documented transitions. **Two real bugs found by live walkthrough
  (tradition holds):** (1) a stale context-switcher cookie from another account redirect-looped
  `/b` — `requireActiveOrg` now validates the cookie org against the user's memberships like
  `resolveActiveContext` does; (2) when the worker marked the post `filled`, the booked
  provider's RLS view of it (and its occurrences) vanished, emptying their booking's dates —
  `opportunities_select` gains `provider_has_applied()` (definer, because a direct
  applications↔opportunities policy cross-reference recurses), logged as a deviation from the
  DATABASE_SCHEMA §10 matrix. Hosted walkthrough end-to-end with the worker live: apply with
  warn-don't-block chips → applicant review → offer (terms `2026-06-draft-1`) → accept → contact
  revealed both ways (phone + definer email) → complete 6h × $95 = $570 record → provider
  counter-signed; bells incremented at every step. Tests: +13 (state machines, dedup, grant
  re-open, visibility incl. filled-post regression, booking-insert RLS both ways, contact reveal,
  slot trigger incl. the slot_count-2 stress case and overbooking stop, past-date no-reopen, and
  `tests/spine.test.ts` — the permanent CI spine: post→alert→apply→offer→book→complete) — 100
  total. Test fixture note: bookings carry RESTRICT FKs, so `cleanupBookings()` precedes the
  auth.users cascade in cleanup. Terms body is DRAFT pending attorney review (bump
  `TERMS_VERSION` on any wording change). **Founder actions open:** add
  `SUPABASE_SERVICE_ROLE_KEY` to `.env` (dashboard → API) to turn on business document viewing;
  Resend + Railway + 10DLC unchanged from Phase 6.
- **2026-06-11 — Phase 6 shipped (matching worker & notifications).** pg-boss 10 worker
  (`npm run worker`, `railway.json` ready) sharing ONE boss instance per process via
  `src/lib/queue.ts` — session pooler, boss max 5 + service pool 5, under Supavisor's 15
  (NotifEyes connection math ported); queues auto-created on both producer and worker so
  startup order never matters; enqueue failures log loudly but never block a post. Matching:
  Stage-1 SQL prefilter (`src/lib/matching/engine.ts`) + pure-function Stage-2 scoring
  (`score.ts`, thresholds in `src/config/matching.ts`) per MATCHING_LOGIC — pay 85% band,
  hour↔day 8h convention flagged approximate, incomparable units → NEAR never silent-fail,
  service ratio, schedule vs zone days/window (midnight-wrap aware) + advisory availability
  template, with a next-occurrence fallback when the 30-day horizon is empty (a shift six
  weeks out must not auto-fail). `hidden_from_search` deliberately does NOT block alerts (it
  gates business search only). Fanout (`fanout.ts`): best-grade zone wins, exact-only zones
  filtered BEFORE the ledger (so a later exact lands as a fresh first alert),
  `opportunity_alerts` ON CONFLICT DO NOTHING with pay snapshot in `score` jsonb; re-alert
  once max on close→exact or pay +10% (same-unit comparison). Dispatcher
  (`src/lib/notifications/dispatch.ts`) takes the DB as a PARAMETER — it sits outside the
  service-role ESLint fence by design, only fenced callers can hand it a connection. One
  notifications row per event + per-channel delivery rows through deliver-email/deliver-sms
  queues (retry 3, backoff); channel selection = zone toggles ∩ category prefs ∩ user opt-ins;
  bounce/complaint suppresses future sends to that recipient; urgent + first date <24h forces
  SMS past zone/category toggles but NEVER past user-level opt-in. Adapters: Resend + Twilio
  REST with console stubs (stubs ARE staging until the founder provisions accounts). Crons:
  generate-occurrences (daily, idempotent on the unique index), expire-opportunities (hourly,
  posted→expired incl. all-dates-past; also expires stale submitted applications per B.11),
  credential-expiry-scan (30d/7d/expired notices, deduped per credential+window),
  booking-reminders + application-stale-nudge (wired live, activate with Phase 7 data).
  Webhooks: Twilio inbound STOP/START/HELP → profile opt-out + `sms_consent_log` (TCPA) and
  status callbacks; Resend delivered/bounced/complained → delivery rows; both verify
  signatures when secrets are set, accept unsigned in stub mode. In-app bell polls
  `/api/notifications` every 25s through dbAs (no LISTEN/NOTIFY, locked rule). **All exit
  criteria verified live on hosted** with the worker running locally: urgent injector shift
  posted via UI → exact-graded alert in seconds (≤60s), email + SMS stubs fired with the SMS
  forced past a zone that had SMS off, duplicate fanout enqueue → 0 new alerts, simulated
  Resend/Twilio webhooks flipped both deliveries to `delivered`, bell showed "1 unread", STOP
  keyword opted the test user out with an audit row. Tests: +23 (15 scoring threshold table,
  8 integration: dedup/grade-gating/urgent-SMS both ways/re-alert-once/cron idempotency) — 87
  total. **Founder actions open:** provision Resend (free tier covers launch volume) +
  Railway worker service (~$5/mo hobby) — Atlas prompts on request; Twilio stays stubbed until
  10DLC clears.
- **2026-06-11 — Phase 5 shipped (opportunity posting).** Posting flow for all 7 MVP types
  (training event + room rental render as "coming soon" cards); type metadata in
  `src/lib/opportunity-types.ts` drives the picker, conditional form sections, and validation.
  Pay enforcement is layered: form `required`, zod mirror of the CHECK semantics with friendly
  copy, and the existing `opportunities_pay_visibility_check` (structurally tested: no-pay /
  bad-range / negotiable-with-max all rejected even via the service role). FT/PT/evergreen pay
  is optional-but-encouraged (B.9 default adopted). Recurrence: weekly builder writes standard
  RFC 5545 `FREQ=WEEKLY;BYDAY=…[;UNTIL=…]` strings; `src/lib/recurrence.ts` (luxon, new dep)
  expands them in the LOCATION's IANA timezone on an 8-week window — DST resolved exactly once
  at generation, unit-tested across the 2026 spring AND fall boundaries incl. a shift spanning
  the 2 AM jump; materialization inserts are `on conflict do nothing` against the
  (opportunity, starts_at) unique index so the Phase 6 cron extension is idempotent. Status
  lifecycle via `assertTransition` tables (`src/lib/state/opportunity.ts`); occurrence-level
  cancel + reschedule (`rescheduled_from_id` lineage) live on the manage page; schedule edits
  regenerate only FUTURE OPEN occurrences. Reach estimate (`src/lib/matching/reach.ts`,
  service-role by design inside the ESLint fence, returns only an aggregate count) implements
  the MATCHING_LOGIC Stage-1 prefilter minus schedule filters (documented as optimistic);
  verified live: ~1 for a matching injector zone, ~0 for the same zone once the post wanted an
  aesthetician. Supervision attestation checkbox is REQUIRED when any selected service's
  category is risk-tier 3 (injectables/laser/IV) — enforced server-side, verified live.
  Public detail page at `/o/[id]` renders through `dbAsAnon`, so posted-only visibility is RLS,
  not an if-statement: drafts 404'd anonymously in the live check. **Two form bugs found by
  live testing:** error redirects appended `?error=` to a URL already carrying `?type=`
  (mangled both params — fail() now picks the separator), and fields absent from a type's form
  variant arrive as `null`, bypassing zod string defaults (normalized to "" in parseForm).
  Hosted walkthrough: one-time injector shift posted (pay $95/hr, attestation), recurring
  Mon/Wed esthetician shift → exactly 16 occurrences over 8 weeks, one canceled + one
  rescheduled with lineage intact, public page checked via cookie-less curl. Deferred to later
  phases: fanout on post (6), apply flow (7), occurrence display on SEO surfaces (10).
- **2026-06-11 — Phase 4 shipped (business side: org profile, locations, team).** Business
  dashboard checklist; org profile (kind/description/website/phone/EMR-POS, logo to the public
  `org-media` bucket — admin-only write policy keyed on the org-id path prefix,
  `drizzle/supabase/0002_storage_org_media.sql`, hosted-only, verified owner-can/poster-can't via
  the storage API); locations CRUD with **street-level geocoding at save** (NotifEyes geocoder
  ported: Nominatim default with config-driven UA, Mapbox drop-in via `MAPBOX_TOKEN`, GA
  bounding-box sanity check, ZIP-centroid fallback; verified live — Lenox Square pin landed at
  33.8496/-84.3634) and timezone fixed to America/New_York at geocode time (GA-only launch);
  team management (owner ⊃ admin ⊃ poster, last-owner guard, owner-role changes are owner-only —
  the latter two are app-level guards, RLS treats admin+ as member-managers); token invites
  (sha256 hash stored, plaintext link shown once to the inviter, 14-day expiry, acceptance bound
  to the invited email by RLS; invite emails arrive with Phase 6 — until then it's copy-link).
  Signup now carries a `?next=` through email confirmation so invite links survive account
  creation. **Security fix found in review:** the `org_members_insert` invitee path didn't pin
  the role to the invite's role — a poster invite was redeemable as owner; policy now requires
  `i.role = role` (migration `0002_yummy_ares`, applied local + hosted, regression-tested).
  **Two bugs found by live testing (again):** (1) the invite page sat inside the `(app)` route
  group whose layout redirects signed-out users to `/login` *without* `next`, eating the invite
  link — moved to a standalone `/invite/[token]` route; (2) org admins can legitimately *see*
  every org invite, so the accept page offered them teammates' invites and accepting would have
  consumed them — page and action now require the signed-in email to match. **New hard-won
  rule (CLAUDE.md #10):** `INSERT…RETURNING` also runs SELECT policies against the pre-insert
  snapshot, so self-qualifying inserts (membership rows) must not use `.returning()`. Deferred:
  location photos UI (schema + bucket ready), member title editing, invite delivery by email
  (Phase 6). Exit criteria all verified on hosted: owner invited an admin and a poster through
  the real UI; poster proven post-capable but management-blocked at the RLS layer (new
  `tests/org-team.test.ts`, 14 tests); both locations geocoded with timezone; second location
  works.
- **2026-06-10 — Phase 3 shipped (provider onboarding + watch zones).** Full provider section: profile (GA-ZIP-centroid home geocoding — no external geocoder needed at launch), services, credentials (requirements engine with required/recommended chips + derived expiry, private document upload, attestation), pay, availability, portfolio (consent attestation, owner-signed URLs), watch zones (all four kinds via Leaflet editor, materialize-at-save, edit re-render from `geometry_meta`), dashboard checklist. Storage: private `credentials`/`portfolios` buckets with owner-path policies (`drizzle/supabase/0001_storage.sql`, hosted-only); browser-direct uploads under the user's JWT; third-party access deferred to the logged signing path (Phases 7/9). Verified end-to-end in the live UI (signup → provider hat → zone on the hosted DB). **Two bugs found by live testing:** empty-array SQL expansion in zone inserts (fixed with array literals), and react-leaflet vs React strict mode double-mount (strict mode disabled — dev-only check, NotifEyes used raw Leaflet to avoid the same). **Ops note:** transient pooler 28P01 for `rls_client` traced to credential-cache churn from re-ALTERing the role password on every migrate; bootstrap now sets the password only at creation. Per-category notification preferences UI deferred to Phase 6 (zones carry per-zone channel toggles).

- **2026-06-10 — Phase 1 approved and started.** Founder accepted all Section A proposed defaults: draft GA credential rules seeded now and validated before launch (A.1); free-text supervision context + post-time attestation, structured org credentials deferred to V2 (A.2 — `locations.supervision_context` + `opportunities.supervision_attested_at`); all provider types self-attest-capable with risk-tiered review (A.3); warn-and-flag contact masking (A.4); transactional-only SMS pending 10DLC registration (A.5); `dbAs()` RLS enforcement path confirmed (A.6); slot_count column exists, MVP UI fixed at 1 (A.7); Census ZCTA/places with centroid fallback (A.8).
- **2026-06-10 — Schema deviations from DATABASE_SCHEMA.md during Phase 1 build:** (1) dropped `provider_profiles.current_employer_private` — RLS grants businesses row-level access, so a "never displayed" column on that row was a leak footgun; (2) moved org `internal_notes`/`admin_flags` to a separate admin-only `organization_admin_notes` table for the same reason; (3) CHECK constraints live in `drizzle/manual/` (drizzle-kit 0.28 can't emit them).
- **2026-06-10 — New open question from seeding (→ A.9 below):** credential requirements are AND-semantics; "GA esthetician OR master cosmetologist license" can't be expressed. Draft seed marks the alternative in `notes`. Needs either an any-of requirement-group model or attorney guidance on which single license to require.
- **2026-06-10 — Phase 2 verified end-to-end on hosted Supabase.** Migrations + seeds + GA geo data applied via the standard runner over the session pooler; signup trigger confirmed firing on Supabase's `auth.users`; smoke test proved signup → profile → provider hat → business hat through the RLS path. **Bug found & fixed:** the founder-bootstrap INSERT policy on `organization_members` self-referenced its own table → Postgres policy-recursion error; fixed via a `SECURITY DEFINER` `org_has_any_member()` helper (migration `0001_calm_speed_demon`), with two new RLS tests covering the path the service-role fixtures had masked (19 total). **Advisor hardening** (`manual/0005`): trigger functions and anon access to the audit-log writers revoked; `spatial_ref_sys` client access revoked; postgis-in-public accepted (NotifEyes parity); reviews deny-all flag is intentional. Data API remains enabled but unused — optionally disable in dashboard settings later (NotifEyes risk-log item).
- **2026-06-10 — Phase 2 built; hosted Supabase project created.** Project `aesthetics-staffing` (`aetbzxovczkzrkstslqb`, us-east-1, ~$10/mo) under the existing Pro org. Supabase Auth via `@supabase/ssr`; `src/proxy.ts` refreshes sessions and gates `/me|/onboarding|/p|/b|/admin`; multi-hat model with context-switcher cookie (never in the JWT); minimal onboarding creates provider/business hats (full wizards are Phases 3/4). Bootstrap (roles incl. `rls_client`, policy helpers) applied to the hosted DB via the management API; the schema migration is applied with the standard `db:migrate` runner once the dashboard password step is done — avoids retyping 78KB of SQL through the API. Tests pinned to the local database via `.env.test`.

## A. Must answer before coding starts

### Product / compliance

1. **GA credential-requirements seed data.** The `credential_requirements` rows for Georgia (who needs what license for which service) drive every warning chip and the admin queue. Wrong seed data = noisy warnings providers learn to ignore. Needs the attorney/regulatory pass in [COMPLIANCE_AND_TRUST.md](COMPLIANCE_AND_TRUST.md) §8 — or an explicit decision to launch with a clearly-labeled draft ruleset. *Proposed default: build with draft rules marked "(draft)" internally; validate before public launch, not before coding.*
2. **Business-side credentials — in or out?** Should orgs attest/record a medical director or supervision arrangement (esp. for injectable/laser posts)? Currently modeled as free-text `supervision_context` on locations. Structured business credentials would add an `organization_credentials` mirror of the provider model. *Proposed default: free-text context in MVP + required attestation checkbox on injectable/laser posts; structured org credentials in V2.* Affects schema → decide now.
3. **Which provider types launch document-review-required vs self-attest-only?** Determines day-one admin workload. *Proposed default: all types self-attest-capable; review queue prioritized by risk tier (injectables/laser/IV first). No type is review-gated.*
4. **Contact-masking strictness.** Warn-and-flag (proposed), hard-block regex matches, or honor system? Changes message UX and schema (`contact_flagged`). *Proposed default: warn-and-flag.*
5. **Twilio 10DLC / toll-free registration** — not a question, an action: start registration the moment coding is approved (weeks of lead time). Decide: transactional-only SMS, or marketing too (changes campaign registration scope)? *Proposed default: transactional only.*

### Technical

6. **Confirm the RLS enforcement path** (TECHNICAL_ARCHITECTURE §5: `dbAs()` + `rls_client` role + ESLint fence). Retrofitting later = rewriting every server action. Needs explicit sign-off because it's the least-reversible technical decision.
7. **Occurrence/booking spine stress test.** Confirm the model handles: one recurring post, `slot_count 2`, provider A accepted for Mondays, provider B for Wednesdays, then one Monday rescheduled. The schema supports it (see DATABASE_SCHEMA §5); confirm the *product* wants slot_count > 1 in MVP UI or column-only. *Proposed default: column exists, MVP UI fixed at 1.*
8. **Geo boundary dataset acceptance.** ZCTAs approximate USPS ZIP routes; Census places miss some unincorporated communities. Accept knowingly (proposed) with centroid+10mi fallback, or invest in a commercial boundary dataset? *(Accepted 2026-06-10; GA data loaded: 675 places, 751 ZCTAs.)*

9. **Credential requirement OR-semantics** *(added 2026-06-10 during seeding)*. GA aesthetician licensure can be satisfied by an esthetician license **or** a master cosmetologist license, but `credential_requirements` rows are AND-semantics. Options: (a) attorney confirms one canonical license to require; (b) add a `requirement_group_id` so any-of groups are expressible; (c) a combined "GA esthetics licensure" credential type. Draft seed requires the esthetician license and notes the alternative. Decide before provider onboarding UI (Phase 3).

## B. Should answer during build (doesn't block Phase 1–2)

9. **Pay requirement for part-time/full-time posts.** Spec requires visibility for shift-family only; multi-state pay-transparency laws (CO/WA/CA…) are irrelevant for GA-only launch but matter for expansion. *Proposed default: encourage (pre-filled range UI) but don't require for FT/PT/salaried.*
10. **Watch-zone backfill.** When a provider creates a zone, should currently-posted matching opportunities alert immediately, or appear only in browse? *Proposed default: show in a "matches now" list on zone save; no notification storm.* (MATCHING_LOGIC §5.)
11. **Application expiry windows.** How long until `submitted` applications auto-expire after deadline/fill? *Proposed default: on opportunity expiration or fill.*
12. **"Available today/this week" decay.** Auto-expire after 24h/7d? *Proposed default: yes, auto-expire with re-confirm nudge.*
13. **Admin impersonation.** Build at all? If yes: explicit user consent, banner, full audit. *Proposed default: defer; admins debug via audit logs + read access.*
14. **Email digest.** Daily digest of close matches for providers who disable per-event email? *Proposed default: V1.1.*
15. **Org verification.** Any business vetting before posting (manual review of first post, EIN attestation, none)? *Proposed default: none at signup; first-post admin notification for eyeball review.*

## C. Can wait until later (V1.1 / V2)

16. **Monetization model** — booking fees vs subscriptions vs paid/urgent post upgrades vs featured placement. Schema is payment-ready; no decision needed pre-launch. (NotifEyes' fee-only pivot is a useful reference point.)
17. **Reviews/ratings shape** — blind dual reviews (NotifEyes 7-day model), private feedback only, or reliability stats only. Table exists deny-all.
18. **Reliability stats display** — when/whether to show cancellation/no-show counts (collected from day one).
19. **Training events & room rental** — activation criteria and type-specific fields.
20. **Automated license verification** — board APIs / third-party services behind the existing `needs_review → admin_reviewed` transition.
21. **Supabase Realtime upgrade** for in-app delivery (polling ships first; schema needs no change).
22. **Multi-state rollout order** and per-state legal checklist execution.
23. **Native mobile timing** (React Native + Supabase Auth carries over).
24. **Provider browse/search for businesses** ("search providers" beyond applicant review) — MVP includes basic search respecting `hidden_from_search`; how rich should V2 filtering get?
25. **Brand name finalization** — everything is config-driven; the rebrand drill in Phase 10 keeps it cheap. Trademark search before public marketing spend.

## D. Assumptions made in this package (flag if wrong)

- Individual providers only; no agencies in any V1 surface.
- Free at launch; no fee mechanics anywhere in MVP UI.
- Georgia-only geography toggle at launch (zones/locations restricted to GA at validation level; model is multi-state).
- Mobile-responsive web only; no push notifications in MVP.
- English only.
- Admin = the founding team via `is_platform_admin`; no admin role hierarchy in MVP.
- The platform never holds or moves money in MVP — completion records are bookkeeping only.
