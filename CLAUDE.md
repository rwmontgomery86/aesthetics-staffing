# CLAUDE.md

Project context for Claude Code sessions in this repo. Read this first; then read the
**Decisions log** at the top of [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) before doing any work.

## What this is

**OpenChair** (WORKING NAME — not legally cleared; never hard-code it outside
`src/config/brand.ts` + env) — a Georgia-first geo-alert staffing marketplace for
aesthetics/beauty/med-spa/wellness. Providers draw **watch zones** (radius/polygon/city/ZIP)
with service/credential/pay/availability filters; businesses post opportunities; matches are
graded **exact/close** and alerted in-app/email/SMS. Architecturally inspired by NotifEyes
(`~/Developer/notifeyes`) — rebuilt clean, patterns ported deliberately.

The full planning package lives in [docs/](docs) — PROJECT_OVERVIEW, MVP_SCOPE,
TECHNICAL_ARCHITECTURE, DATABASE_SCHEMA, USER_FLOWS, MATCHING_LOGIC, COMPLIANCE_AND_TRUST,
IMPLEMENTATION_PHASES, OPEN_QUESTIONS (with the append-only decisions log), BRAND_AND_COPY_NOTES.

## Cursor

**Phases 0–8 complete** (see IMPLEMENTATION_PHASES.md):
schema+RLS, auth+multi-hat accounts, provider onboarding + credentials + private storage +
watch-zone editor, business side (org profile, locations with geocoding, team invites),
opportunity posting (all MVP types, layered pay enforcement, DST-safe occurrence
materialization, reach estimate, public `/o/[id]`), matching worker & notifications (pg-boss
worker `npm run worker` + railway.json, Stage-1 SQL prefilter + Stage-2 pure scoring,
opportunity_alerts dedup + once-max re-alert, dispatcher → deliveries → Resend/Twilio
console-stub adapters, urgent<24h SMS forcing, STOP/HELP + delivery webhooks, in-app bell
polling 25s, crons), applications & bookings (apply with frozen credential snapshot + auto
profile_access_grants, applicant review with chips, offer/accept = the dual terms
click-throughs, provider-creates-booking RLS path, contact reveal gated on the booking row,
occurrence slot trigger with overbooking stop, cancellation/no-show/dispute,
completion_records, notify-event worker pipeline, logged `/api/files/sign`, permanent CI
spine test post→alert→apply→offer→book→complete), messaging (apply-creates-thread + lazy org
join, sendMessageInTx pre-reveal contact screen warn+flag, synchronous contact reveal on
accept, unread via SECURITY DEFINER trigger `drizzle/manual/0007`, worker-posted system
milestones applied/offered/confirmed/canceled, message_received notifications with per-thread
unread debounce, /p/messages + /b/messages + audited /admin/threads, patient-info composer
notice). All verified live on hosted.

**Next: Phase 9 — admin dashboard** (credential review queue, expiring views, user/org/post
management, delivery explorer, reports/disputes incl. flagged messages, audit-log viewer;
every admin mutation writes an audit row). Standing: worker needs a Railway service (~$5/mo,
founder confirms); Resend account for real email (free tier); Twilio adapter stays stubbed
until the 10DLC registration clears (founder waiting on business confirmation as of
2026-06-11). `SUPABASE_SERVICE_ROLE_KEY` added to `.env` 2026-06-11 (document signing live;
key verified against hosted storage). Then Phase 10 (SEO), 11 (hardening/launch).

Standing founder action items: Twilio 10DLC registration; attorney review per
COMPLIANCE_AND_TRUST.md §8 (the 16 GA credential-requirement seed rows are DRAFT until then).

## Stack & infrastructure

Next.js 16 App Router + TS · Tailwind (tokens in `src/app/globals.css`, palette from the logo)
· Drizzle ORM 0.36 (pinned) · Supabase: hosted project **aetbzxovczkzrkstslqb** (us-east-1,
"aesthetics-staffing", under the founder's Pro org) = Auth + Postgres/PostGIS + private Storage
buckets (`credentials`, `portfolios`; owner-path RLS; see `drizzle/supabase/0001_storage.sql`,
hosted-only) · Leaflet/react-leaflet maps · local dev DB: Postgres.app `aesthetics_staffing`
(used by vitest via `.env.test`) · CI: GitHub Actions with a PostGIS container.

Secrets live ONLY in `.env` (gitignored, on this machine). On a new machine you need:
the Supabase database password (dashboard → reset), the `rls_client` password
(rotate per the bootstrap comment), and the anon key (dashboard → API).

## Non-obvious rules — break these and security or the build dies

1. **All user-facing DB access goes through `dbAs()`** (`src/db/client.ts`) — per-transaction
   JWT-claim injection onto the NOINHERIT `rls_client` role; RLS is the security boundary and
   fails closed. `src/db/service.ts` BYPASSES RLS and is ESLint-fenced to `src/workers/**`,
   `src/lib/matching*`, `src/db/**`, `src/app/api/webhooks/**`, tests. Do not widen the fence.
2. **Every new table ships with `pgPolicy` rules in the same schema file** (`src/db/schema/`),
   and a policy may NOT query its own table directly (Postgres recursion error) — use a
   `SECURITY DEFINER` helper in `drizzle/bootstrap/0000_bootstrap.sql` (see
   `org_has_any_member`, found the hard way 2026-06-10).
3. **Migrations:** `npm run db:generate` (never bare drizzle-kit — the post-generate script
   unquotes PostGIS types), then `npm run db:migrate` (bootstrap → drizzle → `drizzle/manual/`).
   GIST/GIN indexes, CHECKs, triggers, grants go in `drizzle/manual/`. Test on local AND hosted.
4. **Never re-`ALTER ROLE rls_client PASSWORD` on migrate** — Supavisor's per-node credential
   cache churns and causes transient 28P01. Password set at creation only (bootstrap comment).
5. **Don't interpolate JS arrays into drizzle `sql\`\``** — empty arrays expand to `()` =
   syntax error. Use the `pgArray()` literal helper pattern (`src/app/(app)/p/zones/actions.ts`).
6. **React strict mode stays OFF** (`next.config.ts`) — react-leaflet re-init crash; dev-only
   check, documented there.
7. **Port 4000** (`npm run dev`), matching `APP_BASE_URL` and the Supabase Auth Site URL.
   Connection pools stay small (max 5): Supabase session pooler has a 15-conn ceiling.
   Queries go through the transaction pooler (:6543), migrations/psql through :5432.
   **Never build on LISTEN/NOTIFY** (Supavisor drops it — NotifEyes production lesson).
8. **Privacy invariants:** credential docs + portfolios are storage PATHS in private buckets,
   never URLs; owners view via their own JWT-signed URLs; business/admin access (Phases 7/9)
   goes through a server signing endpoint that writes `document_access_logs`. Provider pay
   minimums are never shown to anyone. Provider profiles are never publicly indexed.
9. **Credentials warn, never block** (chips via `src/lib/credentials/requirements.ts`); admin
   review decisions are trigger-protected (`drizzle/manual/0004`); expiring/expired are DERIVED
   from `expires_at`, never stored.
10. **No `.returning()` on self-qualifying inserts** — `INSERT…RETURNING` also runs the SELECT
    policy, and STABLE helpers (e.g. `is_org_member`) see the pre-insert snapshot, so the very
    insert that creates the visibility-granting row fails. Insert without returning, re-select
    after (found the hard way 2026-06-11, invite acceptance).

## Working agreements (per the founder)

- **Layman's terms** in explanations and status reports — the founder is non-technical.
- Anything requiring the founder to click around a platform dashboard (Supabase, Vercel,
  Twilio…): produce a **self-contained step-by-step prompt they can paste into GPT Atlas**,
  collecting any values to bring back. Confirm recurring costs before creating paid resources.
- Settled decisions get APPENDED to the decisions log in docs/OPEN_QUESTIONS.md (never edit
  prior entries). Schema deviations from DATABASE_SCHEMA.md get logged there too.
- Verify like Phase 3: tsc + lint + vitest + build, AND a live walkthrough in the preview
  browser against the hosted project (it caught 2 real bugs the suites missed). Test fixtures
  use `@test.local` emails / `rlstest-` prefixes and clean up after themselves.
- Commit per phase with detailed messages; push to
  `https://github.com/rwmontgomery86/aesthetics-staffing`; CI must be green.

## How to verify a change

`npx tsc --noEmit` · `npm run lint` · `npm test` (needs local Postgres.app DB migrated+seeded;
uses `.env.test`) · `npm run build` · preview server via `.claude/launch.json` ("web", port
4000, autoPort false) for UI walkthroughs against the hosted DB (`.env`).

## Seeded/dev credentials

Local-only demo data: `npm run db:seed:demo` (provider@demo.test / owner@demo.test /
admin@demo.test — these exist in the LOCAL DB only). The hosted project has the founder's real
accounts; create throwaway `*@example.com` users via the signup API for hosted tests and delete
them after (auth.users cascade cleans everything).
