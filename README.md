# OpenChair — Planning Package

> **Working name notice:** "OpenChair" is a tentative working name only. It has not been legally cleared. No document in this package, and no future code, should hard-code the brand name, domain assumptions, legal entity names, or trademark-sensitive copy. See [BRAND_AND_COPY_NOTES.md](docs/BRAND_AND_COPY_NOTES.md).

A Georgia-first, geo-alert staffing marketplace for aesthetics, beauty, spa, med spa, and wellness. Individual providers create **watch zones** (radius, polygon, city, ZIP) with service/credential/pay/availability filters and get alerted the moment a business posts a matching opportunity. Architecturally inspired by NotifEyes (optometry staffing); rebuilt clean, not forked.

**Status:** Phase 1 (database, schema, RLS) is built and verified — see [IMPLEMENTATION_PHASES.md](docs/IMPLEMENTATION_PHASES.md) for the roadmap and [OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) for the decisions log. Phase 2 (auth & roles) is next.

## Development

```bash
npm install
# Postgres with PostGIS on localhost:5432 (Postgres.app works), then:
createdb aesthetics_staffing   # or: psql -c "create database aesthetics_staffing"
cp .env.example .env           # adjust DATABASE_URL_* for your local user
npm run db:migrate             # bootstrap (roles/helpers) + drizzle + manual SQL
npm run db:seed                # taxonomies, credential types, DRAFT GA requirements
npm run db:seed:demo           # local-only demo users/org/zone/opportunity
npm run geo:load               # GA Census boundaries (~70 MB download, cached)
npm test                       # RLS policy-matrix suite (requires migrate + seed)
```

**Security model in one paragraph:** user-facing queries go through `dbAs()` in [src/db/client.ts](src/db/client.ts) — a `rls_client` role with per-transaction JWT-claim injection, so RLS policies (defined beside each table in [src/db/schema/](src/db/schema)) are enforced on every query and fail closed. The service-role pool in [src/db/service.ts](src/db/service.ts) bypasses RLS and is import-fenced by ESLint to workers, matching, migrations/seeds, and webhooks. Append-only logs (`audit_logs`, `document_access_logs`) accept writes only via `SECURITY DEFINER` functions.

## Document map

| Document | What it covers |
|---|---|
| [PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | Vision, target users, core concept, core workflows, MVP definition, future vision, what this is not |
| [MVP_SCOPE.md](docs/MVP_SCOPE.md) | Included / excluded / deferred features, acceptance criteria, MVP success definition |
| [TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md) | Stack recommendation, rebuild-vs-fork decision, app/worker/notification architecture, RLS approach, storage, geo, deployment |
| [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Full proposed schema: tables, enums, relationships, indexes, RLS policy matrix, timezone rules, payment-ready design |
| [USER_FLOWS.md](docs/USER_FLOWS.md) | Step-by-step flows: onboarding, watch zones, posting, matching, applying, messaging, booking, completion, admin review |
| [MATCHING_LOGIC.md](docs/MATCHING_LOGIC.md) | Exact/close match rules, geospatial logic, pay/availability/credential handling, dedup, worker responsibilities, edge cases |
| [COMPLIANCE_AND_TRUST.md](docs/COMPLIANCE_AND_TRUST.md) | Credential/review models, suggested disclaimer language, patient-data rules, attorney-review checklist |
| [IMPLEMENTATION_PHASES.md](docs/IMPLEMENTATION_PHASES.md) | Phases 0–11 with scope, exit criteria, checkpoints, and the testing strategy |
| [OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | Questions to answer before coding vs. questions that can wait |
| [BRAND_AND_COPY_NOTES.md](docs/BRAND_AND_COPY_NOTES.md) | Working-name policy, rebrandability checklist, voice/tone, terminology, landing positioning |

## Headline recommendations

1. **Clean rebuild, not a fork** of NotifEyes — port its proven patterns (watch-zone geometry, matching query shape, state machines, notification dispatcher, pg-boss worker layout), replace its gaps (no RLS, single-role auth, public credential-document URLs, no organizations, no recurring model).
2. **Stack:** Next.js (App Router) on Vercel · Supabase Postgres + PostGIS with Drizzle ORM · Supabase Auth · RLS as the real enforcement layer · Supabase Storage private buckets · pg-boss worker on Railway · Resend + Twilio · Leaflet maps.
3. **First coding phase after approval:** Phase 1 — schema, RLS policies, and the `dbAs()` query fence, before any UI.
