# OPEN_QUESTIONS

Organized by what blocks coding vs. what can be decided later. Where a default is proposed, coding proceeds with the default unless overridden.

## Decisions log (append-only)

- **2026-06-10 — Phase 1 approved and started.** Founder accepted all Section A proposed defaults: draft GA credential rules seeded now and validated before launch (A.1); free-text supervision context + post-time attestation, structured org credentials deferred to V2 (A.2 — `locations.supervision_context` + `opportunities.supervision_attested_at`); all provider types self-attest-capable with risk-tiered review (A.3); warn-and-flag contact masking (A.4); transactional-only SMS pending 10DLC registration (A.5); `dbAs()` RLS enforcement path confirmed (A.6); slot_count column exists, MVP UI fixed at 1 (A.7); Census ZCTA/places with centroid fallback (A.8).
- **2026-06-10 — Schema deviations from DATABASE_SCHEMA.md during Phase 1 build:** (1) dropped `provider_profiles.current_employer_private` — RLS grants businesses row-level access, so a "never displayed" column on that row was a leak footgun; (2) moved org `internal_notes`/`admin_flags` to a separate admin-only `organization_admin_notes` table for the same reason; (3) CHECK constraints live in `drizzle/manual/` (drizzle-kit 0.28 can't emit them).
- **2026-06-10 — New open question from seeding (→ A.9 below):** credential requirements are AND-semantics; "GA esthetician OR master cosmetologist license" can't be expressed. Draft seed marks the alternative in `notes`. Needs either an any-of requirement-group model or attorney guidance on which single license to require.

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
