# MATCHING_LOGIC

Rule-based matching (no AI scoring in MVP). Two stages: a **SQL prefilter** over hard criteria (kills non-candidates cheaply, uses the GIST/GIN indexes) and a **TypeScript scoring pass** over soft criteria (produces `exact` vs `close`). The TS layer is pure functions — unit-testable, with all thresholds in one `src/config/matching.ts` constants file.

NotifEyes precedent: its matcher (`src/lib/matching.ts`) is one SQL query with binary predicates. We keep that shape as the prefilter but add the scoring layer because exact/close needs ratios and tolerance bands, and because post-geo candidate sets are small (hundreds, not millions).

## 1. Stage 1 — SQL prefilter (HARD criteria: fail any → no alert, ever)

Run by the fanout worker with the service role (must read across all providers' zones).

| # | Criterion | Predicate |
|---|---|---|
| 1 | Geography | `ST_Intersects(wz.geom, loc.geog)` — *Intersects*, not Contains: a zone sharing an edge with the location should match. No bump-radius concept in MVP (that was NotifEyes monetization) |
| 2 | Provider type | opportunity's `opportunity_provider_types` ∩ provider's `provider_profile_types` ≠ ∅ |
| 3 | Opportunity type | `cardinality(wz.opportunity_types) = 0 OR opp.type = ANY(wz.opportunity_types)` |
| 4 | Service overlap | only when the zone filters services: `cardinality(wz.service_ids) = 0 OR wz.service_ids && opp_service_ids` (≥1 overlap) |
| 5 | Urgent-only zones | `NOT wz.urgent_only OR opp.urgent` |
| 6 | Hygiene | zone not `paused`; provider not `suspended`/`hidden` from matching; no row in `provider_org_blocks` or `org_provider_blocks`; opportunity `status = 'posted'` |
| 7 | Coarse pay bound | `wz.min_pay_cents IS NULL OR comparable_pay >= 0.85 * wz.min_pay_cents` — the close-match floor pushed into SQL to keep the candidate set tight |

**Credential completeness is deliberately NOT a criterion.** Warn-don't-block means paperwork never gates or downgrades an alert — the alert and application UI show a credential chip ("2 required credentials missing — add before applying") computed from `credential_requirements`, but the match grade measures *fit*, not paperwork.

## 2. Stage 2 — TypeScript scoring (SOFT criteria → grade)

`comparable_pay = COALESCE(pay_max_cents, pay_min_cents)` normalized to the zone's pay unit. Hour↔day conversion uses an 8-hour convention (flagged "approximate" in the alert); `per_treatment`/`commission_pct`/`salary_year` vs an hourly floor are **incomparable** → pay criterion scores NEAR (alert with "pay structure differs from your preference"), never silently FAIL.

| Criterion | PASS | NEAR | FAIL |
|---|---|---|---|
| **Pay** | `comparable_pay ≥ zone floor`, or zone has no floor | `≥ 85%` of floor; or `negotiable_min` whose shown minimum is in [85%, 100%); or incomparable units | `< 85%` (already excluded in SQL) |
| **Services** (opportunity's services vs the provider's offered set) | ratio = \|opp ∩ provider\| / \|opp\| = 1.0 | ratio ≥ 0.5 (and ≥ 1 service) | < 0.5 |
| **Schedule** (zone days/time window + provider availability template vs occurrences in the next 30 days) | ≥ 50% of horizon occurrences fit the zone's days AND time window | ≥ 1 occurrence fits; or fits within ±60 min of the window edges | none fit |

- **EXACT** = all three PASS.
- **CLOSE** = no FAIL and at least one NEAR.
- Any FAIL → no alert.

**Special cases**
- No-occurrence types (`part_time`, `full_time`, `contract` without dates, `evergreen`): schedule auto-PASS.
- Pay omitted (allowed only for non-shift-family types): pay auto-PASS.
- Provider availability template is advisory in scoring (it feeds the schedule criterion alongside zone filters); an empty template = no constraint.

**Thresholds** (one config file; tune without code archaeology): pay tolerance `0.85`, service ratio `0.5`, schedule horizon `30 days`, series fit `0.5`, near-window slack `±60 min`.

## 3. Geospatial logic per zone kind

All four kinds materialize to a single `geom geography` column **at save time** (see DATABASE_SCHEMA §4), so the matching query is uniform — one `ST_Intersects` + one GIST index:

- **Radius:** `ST_Buffer(point::geography, radius_m)` — meters-correct on geography.
- **Polygon:** drawn vertices → closed WKT ring → geography. Cap 200 vertices.
- **City:** Census "places" polygon copied from `geo_cities`.
- **ZIP:** ZCTA polygon from `geo_zips`. *Known approximation:* ZCTAs ≠ USPS routes — acceptable, documented.
- **Fallback:** missing boundary → geocoded centroid + 10 mi buffer, `geometry_meta.fallback = true`, surfaced in the UI as "approximate area."

Opportunity side: `locations.geog` point, geocoded at save.

## 4. Occurrences × matching

- Match and alert at the **parent opportunity level only**. A Mon/Wed/Fri recurring shift fires **one** alert, not twelve. Occurrences feed only the schedule criterion.
- Newly generated occurrences (weekly cron extending the 8-week window) **never** re-alert an already-alerted opportunity.
- Occurrence-level applications are a provider choice at apply time, not an alert concept.

## 5. Dedup & re-alert policy

- Ledger: `opportunity_alerts (opportunity_id, provider_profile_id) PK`, written `ON CONFLICT DO NOTHING`. Only a successful insert dispatches a notification — a provider gets at most one alert per opportunity no matter how many of their zones match (best-grade zone attributed) or how many times the fanout job retries (idempotent).
- **Material edit** (pay increase ≥ 10%, or schedule change): `fanout-opportunity-updated` re-runs matching. Never-alerted providers who now match → normal alert. Already-alerted providers re-notify **only if** grade improved close→exact or pay rose ≥ 10%, and at most once (`WHERE realerted_at IS NULL`).
- Zone created/edited after posting: the provider's next-day digest or browse surface shows currently posted matches; no retroactive alert storm (MVP decision — revisit if providers expect immediate backfill).

## 6. Notification trigger logic

| Event | Channels |
|---|---|
| Exact match | per zone channels ∩ user category prefs; respects per-zone `alert_grades` |
| Close match | same, only if zone allows `close` |
| **Urgent** (`opp.urgent` AND first open occurrence < 24h) | **SMS forced on** for providers with urgent-SMS opt-in (`sms_opted_in`, verified phone, no `sms_opt_out_at`), regardless of zone channel defaults; plus in-app/email |
| All alerts | one `notifications` row + `notification_deliveries` rows; sends via `deliver-email`/`deliver-sms` queues with pg-boss retry/backoff |

## 7. Worker responsibilities (matching-related)

| Job | Trigger | Responsibility |
|---|---|---|
| `fanout-opportunity-posted` | status → `posted` | prefilter → score → dedup insert → dispatch |
| `fanout-opportunity-updated` | material edit | re-match + re-alert policy |
| `generate-occurrences` | daily cron | RRULE expansion (8-week window, location TZ); extend series bookings; never re-alerts |
| `expire-opportunities` | hourly cron | past `expires_at`/`application_deadline` or all occurrences past → `expired`; closes stale `submitted` applications |

All idempotent and safely re-runnable (dedup ledger + status guards).

## 8. Edge cases

| Case | Handling |
|---|---|
| Provider in multiple matching zones with different filters | Best grade wins; alert attributes that zone; one alert total |
| Zone with empty filters | Empty array = "all" (types, services, days) — never "none" |
| `negotiable_min` pay | Compared via the shown minimum; minimum below floor but ≥ 85% → NEAR ("negotiable — your floor may be reachable") |
| Incomparable pay units (per-treatment/commission/salary vs hourly floor) | NEAR with explicit "pay structure differs" copy, never silent exclusion |
| DST boundary inside a recurring series | Resolved at occurrence generation in the location's IANA zone; instants stored as `timestamptz` |
| Zone time window spanning midnight (22:00–06:00) | Stored as start > end; scorer handles wrap-around |
| Location on a zone boundary | `ST_Intersects` → matches (inclusive) |
| Opportunity edited to *worse* terms | No re-alert; existing alert stands; detail page shows current terms |
| Opportunity filled/expired between fanout and provider click | Detail page shows real-time status; stale alerts deep-link to "no longer available" state |
| Boundary data updated (ZCTA/places refresh) | `geometry_meta` keeps source refs → re-materialization script; zones unaffected until rerun |
| Provider with zero credentials | Still matched and alerted (warn-don't-block); chip shows missing items |
| `slot_count > 1` | Occurrence stays `open` (and matchable/applicable) until booked count reaches `slot_count` |
| Suspended provider / blocked org | Excluded at prefilter hygiene step |
| Worker crash mid-fanout | pg-boss retries the job; the dedup ledger makes re-runs alert only the not-yet-alerted remainder |
