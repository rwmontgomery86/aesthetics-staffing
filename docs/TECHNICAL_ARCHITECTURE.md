# TECHNICAL_ARCHITECTURE

> Decisions below follow a full inspection of the NotifEyes codebase (`/Users/rossmontgomery/Developer/notifeyes`) — its schema, matching engine, workers, notification system, auth, uploads, deployment configs, and its `docs/launch-plan.md` decisions log.

## 1. Reuse vs. rebuild: **clean rebuild, porting specific patterns**

### What NotifEyes actually is (vs. what was assumed)

| Layer | Assumed | Actual |
|---|---|---|
| Auth | Supabase Auth | **Auth.js v5** (credentials + JWT), single role per user (`practice_owner/practice_scheduler/od/admin` with `practiceId`/`odId` directly on the user row) |
| DB access | Supabase client | **Drizzle ORM** direct Postgres connections (Supabase-hosted Postgres + PostGIS) |
| RLS | Assumed present | **None.** All authorization is app-layer TypeScript guards |
| Storage | Supabase Storage | **UploadThing — public URLs**, including license documents |
| Realtime | — | `pg_notify` → SSE relay, **broken in production by Supabase's Supavisor pooler**; fell back to client polling |

### Why not fork

The deltas OpenChair needs touch every layer simultaneously:

1. **Schema** — optometry-specific entities throughout (`optometrists`, `practices`, `shifts`); no services taxonomy, no credential-requirements engine, no organizations/locations/teams, no recurring occurrences. Renaming is a rewrite.
2. **Auth** — single-role-on-user-row cannot express "one user is a provider AND a member of two organizations." The fix changes the session model, every guard, and every query.
3. **RLS** — must exist from migration 0001. Retrofitting RLS onto a guards-only codebase means rewriting every server action's data access.
4. **Storage** — public credential-document URLs are disqualifying for this domain; the fix changes the upload pipeline, the schema (paths, not URLs), and every render site.
5. **Booking spine** — recurring occurrences reshape applications/bookings, the most load-bearing tables.

What survives is the **pattern library**, ported deliberately into a new repo.

### Port these NotifEyes patterns (proven in production)

- **Watch-zone storage:** PostGIS `geography` column + JSONB `geometry_meta` snapshot so the UI re-renders the exact original shape; circles pre-buffered server-side via `ST_Buffer`, polygons via WKT + `ST_GeomFromText` (`src/app/(od)/d/watch/actions.ts`).
- **Matching query shape:** spatial predicate + array/JSONB containment filters + pay floor + blocklist in one indexed SQL pass (`src/lib/matching.ts`) — kept as our *prefilter* (§6).
- **State machines:** `Record<Status, Status[]>` transition tables + `assertTransition()` called by every mutating action (`src/lib/state/*.ts`).
- **Notification dispatcher + channel adapters** with graceful console stubs when API keys are absent (`src/lib/notifications/`) — extended with per-delivery logging (§7).
- **pg-boss worker layout:** queue registration + cron schedules + idempotent rescannable jobs (`src/workers/index.ts`).
- **Zod env validation** (`src/env.ts`); **manual SQL migrations for GIST indexes** (drizzle-kit can't emit them; `drizzle/manual/0001_spatial_indexes.sql`); **Geocoder interface** (Nominatim default, Mapbox drop-in); **server-actions-first** mutations with Zod re-validation; Leaflet + leaflet-draw zone editor UI; Playwright "spine" e2e covering the full core loop.

### Do NOT copy

- Auth.js single-role model → Supabase Auth + capability-by-association (§4).
- App-layer-only authorization → RLS as the enforcement layer (§5).
- Public UploadThing URLs → Supabase Storage private buckets + logged signed URLs (§8).
- `pg_notify`→SSE realtime → polling now, Supabase Realtime Broadcast later (§7).
- `channelsSent` array on notifications → `notification_deliveries` rows with webhook-updated statuses (§7).
- HH:MM strings with implicit timezone → `timestamptz` + IANA timezone on locations (§9).
- Denormalized rating/cancellation counters without triggers (drift risk) → compute or maintain transactionally when reviews ship.
- Naïve single-process Nominatim rate limiter — acceptable only while geocoding stays low-volume; revisit before bulk imports.

## 2. Recommended stack

| Layer | Pick | Rationale |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript, Vercel | Proven in NotifEyes; server actions + RSC fit the form-heavy product; Vercel is the known-good deploy path |
| Database | Supabase Postgres + **PostGIS** | PostGIS is non-negotiable for watch zones; Supabase gives managed Postgres + Auth + Storage + Realtime in one bill |
| ORM/migrations | **Drizzle ORM** (+ drizzle-kit, + manual SQL migrations for GIST/RLS/roles) | Typed schema-as-code; NotifEyes conventions carry over; Drizzle ≥0.36 supports `pgPolicy` so RLS lives next to table definitions |
| Auth | **Supabase Auth** via `@supabase/ssr` | `auth.uid()` works natively inside RLS and Storage policies; magic link/OTP/password/reset for free; carries to React Native in V2 |
| Authorization | **RLS as enforcement layer** + thin app guards for UX | §5 |
| Files | **Supabase Storage**, private buckets | §8 |
| Jobs | **pg-boss on Railway** (single replica) | Postgres-backed queue + cron, no Redis; production-proven in NotifEyes including against Supabase |
| Email | **Resend** (HTTP API) with console stub fallback | NotifEyes pattern, verified live |
| SMS | **Twilio** REST with console stub; status + inbound (STOP/HELP) webhooks | Begin 10DLC/toll-free registration immediately — weeks of lead time |
| Maps | **Leaflet + leaflet-draw**, OpenStreetMap tiles | Free, proven; the NotifEyes zone editor is directly portable |
| Geocoding | Geocoder interface: Nominatim default, Mapbox when token present | Port verbatim |
| UI | Tailwind + Radix primitives, react-hook-form + Zod | Port the approach, **not** the NotifEyes visual identity — OpenChair needs its own distinct design system |
| Errors/analytics | Sentry (prod-only init, `sendDefaultPii: false`) + PostHog | Port config pattern |
| Testing | Vitest + Playwright + SQL-based RLS tests | §11 and IMPLEMENTATION_PHASES |

## 3. System topology

```
                ┌────────────────────────────┐
                │  Vercel — Next.js app       │
                │  RSC + server actions      │
                │  dbAs(userId) ─ RLS role   │──┐
                └──────────┬─────────────────┘  │ signed URLs
                           │ :6543 transaction  │
                           │ pooler (queries)   ▼
┌──────────────┐   ┌───────┴────────────────────────────┐
│ Railway       │   │  Supabase                          │
│ pg-boss worker│──▶│  Postgres + PostGIS (RLS on)       │
│ service role  │   │  Auth (JWT / auth.uid())           │
│ :5432 session │   │  Storage (private buckets)         │
└──────┬───────┘   └────────────────────────────────────┘
       │ Resend HTTP / Twilio REST
       ▼
  email + SMS ──▶ delivery webhooks ──▶ /api/webhooks/* (Vercel) ──▶ notification_deliveries
```

**Connection-pool discipline (a NotifEyes production lesson — its worker crashed on Supabase's 15-connection session-pooler ceiling):**

- App queries (Drizzle): **transaction pooler, port 6543** (`DATABASE_URL_POOLED`) — multiplexes serverless invocations safely; per-transaction `set_config` works here because it's transaction-scoped.
- pg-boss (worker): **session pooler/direct, port 5432** (`DATABASE_URL`), pool capped explicitly (max 5).
- No component may use `LISTEN` — Supavisor does not forward async NOTIFY to pooled clients (confirmed failure in NotifEyes).
- Inventory every pool at boot; document maxima in `env.ts` comments.

## 4. Auth & role model

**Identity:** Supabase Auth. Sessions via `@supabase/ssr` cookies; Next.js middleware refreshes tokens; server actions resolve `auth.uid()` from the session.

**Capability-by-association, not role-on-user:**

- `profiles` (1:1 with `auth.users`): name, phone, timezone, notification opt-ins, `is_platform_admin`, `suspended_at`.
- A user **is a provider** iff a `provider_profiles` row exists for them.
- A user **is a business member** iff `organization_members` rows exist (roles `owner | admin | poster` per org; a user can belong to many orgs).
- A user **is an admin** iff `profiles.is_platform_admin`.
- All three can be true at once. The UI offers a context switcher (active context in a cookie — never baked into the JWT, so adding a user to an org takes effect immediately).

**Role resolution = DB lookups, not JWT custom claims.** RLS policies rely only on `auth.uid()`; membership/admin checks are `STABLE SECURITY DEFINER` SQL helper functions (`is_platform_admin()`, `is_org_member(org)`, `has_org_role(org, min_role)`, `my_provider_profile_id()`), wrapped as `(select fn(...))` in policies so Postgres caches them per statement. Custom claims go stale mid-session and get ugly for multi-org users; revisit only if policy lookups ever dominate p95.

## 5. Security: RLS as the enforcement layer

**The problem:** Drizzle connecting as `postgres` bypasses RLS entirely (NotifEyes' situation — zero RLS, guards only). With many AI-generated server actions, one forgotten guard = silent data leak.

**The decision:** make the safe path the only path.

1. Create a dedicated login role that does **not** bypass RLS:
   ```sql
   create role rls_client with login password '…' noinherit;
   grant anon, authenticated to rls_client;
   ```
2. Export exactly **one** user-facing DB entrypoint from `src/db/client.ts`:
   ```ts
   export async function dbAs<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
     return rlsDb.transaction(async (tx) => {
       await tx.execute(sql`
         select set_config('request.jwt.claims',
                  ${JSON.stringify({ sub: userId, role: "authenticated" })}, true),
                set_config('role', 'authenticated', true)`);
       return fn(tx);
     });
   }
   ```
   `set_config(..., true)` is transaction-local, so this is safe through the transaction pooler. `auth.uid()` inside policies resolves from the injected claims — the **same policies** also protect the PostgREST Data API if it's ever enabled.
3. `src/db/service.ts` exports the service-role pool — importable **only** by `src/workers/**`, `src/lib/matching.ts`, and webhook handlers. Enforced with an ESLint `no-restricted-imports` rule so generated app code physically can't reach it.
4. Keep thin `requireProvider()` / `requireOrgRole()` guards in server actions for friendly 403s and redirects — they are UX, not the security boundary.
5. Policies are defined with Drizzle `pgPolicy` in the same schema files as their tables; every new table ships with policies in the same migration. RLS is enabled on **all** tables (deny-by-default), including future-only ones like `reviews`.
6. Supabase Data API stays disabled in project settings (NotifEyes risk-log item), but policies are written as if it were on — defense in depth.

Sensitive-table policy matrix: see [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) §RLS.

**Audit:** append-only `audit_logs` (INSERT only via `SECURITY DEFINER` function; DML revoked from `authenticated`) for admin and state-changing actions; `document_access_logs` for every credential/portfolio signed-URL issuance and admin view — providers can see who accessed their documents.

## 6. Matching architecture (summary — full spec in MATCHING_LOGIC.md)

SQL **prefilter** (service role; hard criteria: `ST_Intersects` geography, provider-type overlap, opportunity-type filter, service overlap when filtered, hygiene checks, coarse pay bound) → **TypeScript scoring** (soft criteria: pay tolerance, service ratio, schedule fit) → grade `exact | close` → dedup insert into `opportunity_alerts` (`ON CONFLICT DO NOTHING`) → dispatch. The TS scoring layer departs from NotifEyes' single binary query because exact/close needs ratios and tolerance bands — and pure functions are unit-testable, which matters when agents write the code. Candidate sets after the geo filter are small (hundreds), so two stages cost nothing.

## 7. Notification & worker architecture

**Dispatcher redesign** (vs. NotifEyes' inline sends + lossy `channelsSent` array):

1. Write the `notifications` row (in-app inbox is instantly correct).
2. Write one `notification_deliveries` row per eligible channel (status `queued`), honoring per-category `notification_preferences`, global opt-ins, and `sms_opt_out_at` — transactional safety notices bypass preferences.
3. Enqueue `deliver-email` / `deliver-sms` pg-boss jobs carrying the delivery ID (retry with exponential backoff lives in pg-boss, not in the channel adapter — fixing NotifEyes' fire-and-forget channel failures).
4. Adapters send via Resend/Twilio, stamp `sent` + provider message ID; **webhooks** (Resend events, Twilio status callbacks) update `delivered/failed/bounced`; bounces mark the address `suppressed` for future sends.
5. Twilio inbound webhook handles STOP/START/HELP → `sms_consent_log` + flips `profiles.sms_opt_out_at` (TCPA trail).

**Queues:** event-driven `fanout-opportunity-posted`, `fanout-opportunity-updated`, `deliver-email`, `deliver-sms`, `application-events`; cron `generate-occurrences` (daily, 8-week rolling window), `credential-expiry-scan` (daily, T-30/7/1), `booking-reminders` (15 min), `expire-opportunities` (hourly), `application-stale-nudge` (daily). All cron jobs idempotent and re-runnable (NotifEyes dedup-scan pattern).

**In-app realtime: polling (~25s) for MVP.** The NotifEyes `pg_notify`→SSE relay is confirmed broken through Supavisor; do not rebuild it. Polling an unread-count endpoint (partial-index query) shipped fine there. Fast-follow: **Supabase Realtime Broadcast** on private per-user channels via a `realtime.broadcast_changes()` trigger on `notifications` — Realtime reads the WAL server-side, so the pooler issue is irrelevant, and the schema needs no change.

## 8. Storage approach

Buckets: `credentials` (private), `portfolios` (private), `org-media` (public: logos, location photos), `avatars` (public).

- DB stores **storage paths, never URLs**.
- Owner read/write enforced by Storage RLS on path prefix (`(storage.foldername(name))[1] = auth.uid()::text`).
- Business access to a provider's documents/portfolio is **never** a storage-policy join: the server verifies a `profile_access_grants` row (auto-created when the provider applies; revocable), issues a **5-minute signed URL**, and writes a `document_access_logs` row. Admin views go through the same logging endpoint.
- Client-side image compression before upload (port the NotifEyes `FileField` approach); 4–8 MB caps; JPEG/PNG/WebP/PDF only.

This directly fixes the NotifEyes public-credential-URL gap.

## 9. Map / geography approach

- **One geometry column for all four zone kinds.** Radius → `ST_Buffer` of the center point; polygon → WKT from drawn points; **city/ZIP → materialized at save time** from reference polygons. `geometry_meta` JSONB keeps the source (center/radius, points, place GEOID, or ZIP) for UI re-render and re-materialization if boundary data updates. The matching engine only ever sees `geom` + one GIST index.
- Reference tables: `geo_zips` (Census ZCTA polygons) and `geo_cities` (Census "places"), **Georgia loaded first**, other states loaded on demand. Known caveat: ZCTAs approximate USPS ZIP routes — acceptable, documented. Fallback when a boundary is missing: geocoded centroid + 10 mi buffer, flagged in `geometry_meta`.
- Locations geocoded at save (Geocoder interface); each location stores an **IANA timezone** resolved at geocode time.
- **Timezone rules (fixing the NotifEyes HH:MM wart):** every concrete instant is `timestamptz`. Local wall times exist in exactly two places — recurrence templates (`recurrence_local_start` + the location's timezone) and watch-zone time filters (interpreted in the *opportunity location's* timezone at match time). RRULE expansion happens once, in the location's zone, at occurrence-generation time, so DST is resolved exactly once.

## 10. Deployment

- **Vercel**: Next.js app, preview deploys per PR, env via dashboard.
- **Railway**: pg-boss worker, single replica (one-worker-per-DB rule), `restartPolicyType: ON_FAILURE`, nixpacks + `tsx` start (port NotifEyes `railway.json`).
- **Supabase**: Postgres + PostGIS + Auth + Storage; Data API disabled; pool topology per §3.
- **CI (GitHub Actions)**: typecheck + `next build` with dummy env; Playwright spine e2e against a fresh PostGIS container with migrate + seed (port the NotifEyes workflow). Add an RLS test job.
- **Env validation**: Zod in `src/env.ts`; optional integrations stub gracefully; **brand comes from env/config** (`NEXT_PUBLIC_APP_NAME`, `APP_BASE_URL`, `EMAIL_FROM`) — see BRAND_AND_COPY_NOTES.
- Estimated infra burn at beta: ~$60–80/mo (Vercel + Railway + Supabase Pro + Twilio), matching NotifEyes' observed ~$66/mo.

## 11. Future mobile considerations

V1 is mobile-responsive web (the watch-zone map editor must work with touch). V2 native path: React Native/Expo reusing Supabase Auth (first-class RN support) and the same RLS-protected data layer; notifications gain a `push` channel by adding one adapter + a device-tokens table; no schema changes anticipated. Avoid web-only assumptions in server actions (keep mutation logic in plain functions callable from a future API layer).

## 12. Answers to the brief's direct questions

| Question | Answer |
|---|---|
| Fork/reuse NotifEyes? | No — clean rebuild in this repo |
| Rebuild inspired by it? | Yes — port the §1 pattern list deliberately |
| Patterns to reuse | Watch-zone geometry+meta, matching prefilter shape, state machines, dispatcher/adapters, pg-boss layout, env validation, geocoder, manual GIST migrations, server-actions pattern, spine e2e |
| Patterns to avoid | Auth.js single-role, no-RLS guards-only auth, public upload URLs, LISTEN/NOTIFY realtime, lossy channel logging, HH:MM timezone-less times, unmanaged denormalized counters |
| Best stack | §2 table |
| What changes given more provider types, credential complexity, messaging, bookings, SEO, payments-later | Taxonomy + credential-requirements engine as data (not enums); organizations/locations/teams; RLS + private storage from migration 0001; parent/occurrence booking spine; per-delivery notification logs; SEO page architecture driven by the same taxonomies; payment-ready columns with zero processing |
