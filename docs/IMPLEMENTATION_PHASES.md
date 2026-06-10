# IMPLEMENTATION_PHASES

Incremental build with a checkpoint after every phase: working software, green CI, and a short review before the next phase starts. Each phase lists scope and **exit criteria**. Testing is woven into each phase (strategy summarized in §Testing at the end). NotifEyes-style discipline applies: a cursor/decisions log in this repo once coding starts, spine-file changes serialized, `tsc --noEmit` + `next build` + CI green before merge.

## Phase 0 — Repo inspection & architecture decision ✅ (complete)

NotifEyes inspected end-to-end; rebuild-not-fork decided; stack, RLS strategy, schema, and matching design settled. Outputs: this planning package. Remaining Phase 0 actions when coding is approved:
- Initialize repo, CI skeleton (typecheck + build + test jobs), Vercel/Railway/Supabase projects (neutral names — brand not finalized).
- **Start Twilio 10DLC/toll-free registration immediately** (weeks of lead time; blocks Phase 6 SMS).
- Resolve the "must answer before coding" items in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).

## Phase 1 — Database, schema, RLS  ← **first coding phase**

- Drizzle schema for all tables in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), with `pgPolicy` RLS in the same files; manual migrations for PostGIS extension, GIST/GIN indexes, `rls_client` role, policy helper functions, `record_audit()`.
- `src/db/client.ts` (`dbAs()` — the only user-facing entrypoint) and `src/db/service.ts` (service role) **with the ESLint import fence, in the first PR**.
- Seed scripts: taxonomies (provider types, categories, services), credential types, **draft** GA credential requirements (marked unvalidated until attorney pass), demo users/orgs.
- Geo reference ingestion: GA ZCTA + Census places → `geo_zips`/`geo_cities`.
- Zod `env.ts`; brand config (`src/config/brand.ts` + env).
- **Exit criteria:** migrations run clean on fresh DB; RLS test suite proves the sensitive-table matrix (provider can't read another's credentials; org member can't read another org's applicants; deny-all on `reviews`/`audit_logs`); `dbAs()` round-trips a policy-gated query; CI green.

## Phase 2 — Auth & roles

- Supabase Auth via `@supabase/ssr`: signup/login/magic link/reset; `profiles` trigger; middleware session refresh.
- Multi-hat model: provider hat, org membership hat, admin flag; context switcher; `/me` role-based routing (NotifEyes pattern); thin `requireProvider()/requireOrgRole()/requireAdmin()` UX guards.
- App shell + design-system foundation (tokens, primitives — OpenChair's own identity, not NotifEyes').
- **Exit criteria:** a user can sign up, hold provider + org-member hats simultaneously, switch contexts; guards redirect correctly; e2e auth smoke test green.

## Phase 3 — Provider onboarding, profile, watch zones

- Onboarding wizard (USER_FLOWS §1): categories, services, credentials (self-attest + document upload to private `credentials` bucket), pay prefs, availability, notification prefs.
- Credential requirements engine surfaces required/recommended chips; warning states.
- Watch-zone editor: Leaflet + leaflet-draw, four kinds, materialize-at-save, `geometry_meta` re-render; zone list with pause/edit/delete.
- Portfolio upload (private bucket) + consent attestation.
- **Exit criteria:** full provider onboarding works on mobile; all four zone kinds save and re-render correctly (incl. ZIP fallback); credential docs unreachable without signed URL; chips accurate against seed requirements.

## Phase 4 — Business onboarding, organizations, locations

- Org creation, locations (geocode + timezone), team invites with roles, org profile (internal + public-slug variants).
- Member management UI; org switcher for multi-org users.
- **Exit criteria:** owner invites an admin and a poster; poster can post but not manage members (RLS-proven); locations geocode and store timezone; second location works.

## Phase 5 — Opportunity posting

- Posting flow for all MVP types (training/room-rental visible as "coming soon"); pay-visibility enforcement (form + DB CHECK); RRULE builder for recurring; occurrence materialization; urgent flag; deadlines/auto-expiration; reach estimate ("~N providers watching").
- Opportunity management: edit, cancel, occurrence-level edit; status lifecycle with `assertTransition` state machines.
- Public opportunity detail page (posted only).
- **Exit criteria:** one-time and recurring posts create correct occurrences (DST-safe across a spring/fall boundary in tests); hidden pay structurally impossible for shift-family; reach estimate within sanity bounds.

## Phase 6 — Matching worker & notifications

- Railway pg-boss worker: `fanout-opportunity-posted/updated`, `deliver-email`, `deliver-sms`, cron jobs (`generate-occurrences`, `credential-expiry-scan`, `booking-reminders`, `expire-opportunities`, `application-stale-nudge`); split-pool config (transaction pooler for app, capped session pool for boss).
- Matching engine: SQL prefilter + TS scoring per [MATCHING_LOGIC.md](MATCHING_LOGIC.md); `opportunity_alerts` dedup; re-alert policy.
- Notification pipeline: dispatcher → `notifications` + `notification_deliveries` → channel adapters (Resend/Twilio with console stubs) → webhook status updates → STOP/HELP consent handling; in-app bell with ~25s polling.
- **Exit criteria:** posting a matching opportunity produces a correctly-graded alert ≤60s in staging; exact-only zones never receive close; urgent <24h forces SMS for opted-in test user; duplicate fanout runs produce zero duplicate alerts; delivery rows reflect webhook statuses; Vitest scoring suite covers the threshold table + edge cases.

## Phase 7 — Applications & bookings

- Apply flow (series/occurrence scope, credential snapshot, auto `profile_access_grants`); applicant review UI with credential/portfolio chips; selection; dual confirmation + versioned terms click-through; `bookings`/`booking_occurrences`; cancellation/no-show/disputed statuses; completion + `completion_records`; reminders wired to Phase 6 cron.
- Provider booked/completed/canceled/past views; business equivalent.
- **Exit criteria:** the slot_count-2 stress case works (provider A Mondays + provider B Wednesdays on one post); contact stays hidden pre-confirmation; completion record generated; e2e spine test (post→alert→apply→book→complete) green — this becomes the permanent CI spine.

## Phase 8 — Messaging

- Context-bound threads, participants, unread counts; system messages on milestones; pre-reveal contact regex warn+flag; patient-info composer warning; admin thread access (audited).
- **Exit criteria:** RLS-proven participant-only access; flag fires on phone/email pre-reveal and not post-reveal; message notification respects category prefs.

## Phase 9 — Admin dashboard

- Credential review queue (risk-tier sort, signed-URL doc view, decisions + notify); expiring/expired views; user/org/opportunity/application/booking management (suspend, remove post); notification delivery explorer; reports/disputes list; audit-log viewer.
- **Exit criteria:** every admin mutation writes an audit row; every document view writes an access-log row; review decision round-trips to provider notification; non-admins blocked by RLS (tested).

## Phase 10 — Public landing & SEO pages

- Landing page; GA staffing page; programmatic pages from taxonomies: provider-type × city/region × business-type × opportunity-type; metadata/OG architecture; sitemap (public pages only); `noindex` on all provider surfaces; brand entirely from config.
- Marketing copy per BRAND_AND_COPY_NOTES voice.
- **Exit criteria:** Lighthouse SEO/a11y ≥ 90 on public pages; provider profiles absent from sitemap and `noindex`-verified; rebrand drill: changing `NEXT_PUBLIC_APP_NAME` + brand config renames every surface (app chrome, emails, SMS sender copy, metadata) with zero stragglers (grep-able check in CI).

## Phase 11 — QA, hardening, deployment

- Full Playwright pass on core workflows (both sides + admin); RLS suite re-run; load-sanity on fanout (1k zones); pool-exhaustion check (the NotifEyes 15-connection lesson); Sentry + PostHog wiring; backup/restore drill; seed production with taxonomies + GA geo data; legal copy placeholders swapped for attorney-approved text; soft-launch checklist.
- **Exit criteria:** staging burn-in week with zero Sev-1s; production deploy live behind an invite gate.

---

## Testing strategy (cross-phase)

| Layer | Tooling | What it covers |
|---|---|---|
| Unit | Vitest | Matching scorer (threshold table, every edge case in MATCHING_LOGIC §8), state machines, pay normalization, RRULE/DST expansion, credential-requirement union logic |
| RLS/security | SQL-based tests (pgTAP or plain scripts in CI) | The full policy matrix; `dbAs()` claim injection; storage-path access; audit-log immutability |
| Integration | Vitest against a PostGIS test DB | Prefilter SQL correctness (geo kinds, arrays, blocklists), dedup ledger, occurrence generation |
| Worker | Vitest + test queue | Job idempotency, retry behavior, delivery-row lifecycle, webhook handlers |
| E2E | Playwright (CI: fresh PostGIS container, migrate + seed — NotifEyes CI pattern) | The spine flow; auth; zone editor smoke; admin review |
| Migration safety | CI job | Migrations apply to fresh DB and to a copy of the previous schema; no destructive change without an explicit marker |

## Sequencing notes

- Phases 3 and 4 can partially parallelize after Phase 2 (side-isolated routes — the NotifEyes parallel-agents rule applies: spine files one-at-a-time).
- Phase 6 is the riskiest integration phase; budget slack there.
- SMS go-live depends on Twilio registration started in Phase 0, not on code.
- Attorney review (COMPLIANCE_AND_TRUST §8) runs concurrently from Phase 1; its output gates Phase 11's copy swap and the credential-requirements seed validation.
