# USER_FLOWS

Step-by-step flows for the MVP. Notation: **[notify]** = notification dispatched per preferences; **[audit]** = audit-log row; **[worker]** = background job. Status names reference the enums in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

## 1. Provider onboarding

1. Sign up (email/password or magic link via Supabase Auth) → `profiles` row created by trigger.
2. Choose "I'm a provider" (a user may also create/join a business later — the same account holds both hats).
3. Create provider profile: display name, optional photo, bio, home city/ZIP (geocoded), travel radius.
4. Choose one or more provider categories (e.g., Injector → pick license type RN/APRN-NP/PA/MD/DO; Aesthetician; Laser tech; Massage therapist; Makeup artist; Wellness).
5. Select services offered from the taxonomy (grouped by category), optional per-service years of experience.
6. Credentials step — the requirements engine lists applicable credentials (union of provider-type/category/service rules for GA), each marked *required* or *recommended*:
   - For each: enter license/cert number, issuing state/board, expiration date; optionally upload document (→ `credentials` bucket, status `document_uploaded`) or self-attest (status `self_attested`).
   - **Skipping is allowed** — the profile shows persistent warning chips ("2 required credentials missing"). No hard block in MVP.
7. Set pay preferences: minimum rate + unit, accepted pay structures.
8. Set weekly availability template + urgent availability toggle + optional "available today/this week" status.
9. Create first watch zone (flow 3). Onboarding nudges until at least one zone exists — no zone, no alerts.
10. Set notification preferences: exact-only vs exact+close, urgent alerts, email/SMS/in-app toggles. SMS requires phone verification + explicit consent (logged to `sms_consent_log`).
11. Optional: portfolio upload with rights/consent attestation; visibility explanation shown ("only businesses you apply to or approve").
12. Done → provider dashboard. Profile is live for matching immediately (self-attest path); admin review proceeds asynchronously (flow 11).

## 2. Business onboarding

1. Sign up (or reuse an existing account — provider accounts can add a business hat).
2. Create organization: name, business type, description, website, phone, optional logo. Creator becomes `owner`.
3. Add first location: address (geocoded → point + timezone), parking notes, dress code, supervision/medical-director context, equipment/devices, products/brands, optional photos, software/EMR/POS.
4. Optional: invite team members by email with role `admin` or `poster` → `organization_invites`; invitee accepts → `organization_members`. **[audit]**
5. Optional: complete the provider-facing internal profile (what providers see when they get an alert).
6. Done → org dashboard, prompted to post the first opportunity (flow 4).

## 3. Watch-zone creation (4 kinds)

1. From provider dashboard → Watch Zones → New zone. Map UI (Leaflet) with mode tabs:
   - **Radius:** drop/center a pin (search or tap), drag a radius slider (mi) → server buffers to a polygon (`ST_Buffer`).
   - **Polygon:** draw freehand vertices (leaflet-draw), 3–200 points → server stores WKT polygon.
   - **City:** type-ahead against `geo_cities` (GA) → server copies the place polygon.
   - **ZIP:** enter ZIP(s) → server copies ZCTA polygon(s); missing boundary → centroid + 10 mi buffer with a "approximate area" note.
2. Set filters: opportunity types (default all), services (default: all my services), minimum pay + unit, days of week, time window, urgent-only toggle, alert grades (exact-only vs exact+close).
3. Choose channels for this zone: in-app / email / SMS (SMS disabled until phone verified + consented).
4. Save → `watch_zones` row with materialized `geom` + `geometry_meta`. Zone renders back exactly as drawn.
5. Zones can be paused, edited (re-materializes), or deleted. A zone edit re-runs matching against currently posted opportunities **[worker: fanout-opportunity-updated semantics]** but never re-alerts already-alerted opportunities.

## 4. Opportunity posting (one-time)

1. Org member (role ≥ poster) → New opportunity → pick type (training event & room rental shown as "coming soon").
2. Select location; set title, description, provider type(s) needed, services needed, required license/credential context.
3. Schedule: date, start/end time (in the location's timezone).
4. Pay (enforced for shift-family types): structure (hourly/daily/per-treatment/commission/salary/negotiable) + fixed value, range, or minimum-shown. The form will not submit hidden pay for shift-family posts.
5. Details: equipment available, products/brands, expected client volume, dress code, supervision/medical-director context, liability/insurance expectations, notes, application deadline, auto-expiration date, urgent/same-day flag.
6. Preview shows an estimated reach: "~N providers are watching this area" (count query against zones — NotifEyes `countOdsMatchingShift` pattern).
7. Post → status `posted`, one `opportunity_occurrences` row, **[worker: fanout-opportunity-posted]**.

## 5. Recurring opportunity posting

1. Same flow, type `recurring_shift`; schedule step captures pattern (e.g., every Mon/Wed 9–5), start date, end date or "ongoing," via RRULE builder UI.
2. Post → occurrences materialized for the next 8 weeks **[worker: generate-occurrences extends weekly]**.
3. Single alert fans out for the **parent** — providers are never alerted per occurrence.
4. Business can later edit the series (regenerates open future occurrences; booked ones require per-occurrence reschedule, flow 10) or edit/cancel a single occurrence.

## 6. Matching & alerting

1. **[worker: fanout-opportunity-posted]** runs the SQL prefilter (geography, provider type, opportunity type, services, hygiene, coarse pay) then TS scoring → grade `exact`/`close` (full rules in [MATCHING_LOGIC.md](MATCHING_LOGIC.md)).
2. Dedup insert into `opportunity_alerts`; per provider, respect zone `alert_grades` (exact-only users never get close matches).
3. Notification created: **"Exact match"** or **"Close match"** label, opportunity summary, pay, distance, credential chip if requirements are missing ("Add your laser cert before applying").
4. Channels: in-app always (if enabled); email per prefs **[worker: deliver-email]**; SMS if zone+user opted in **[worker: deliver-sms]**. **Urgent + starts <24h → SMS forced on for urgent-SMS-opted-in providers.**
5. In-app bell updates within one polling interval (~25s).

## 7. Applying

1. Provider opens the opportunity detail (full business internal profile, location notes, pay, schedule, requirements with their own credential status mapped against each).
2. If required credentials are missing/expired: prominent warning, **apply still allowed** (warn-don't-block); the application carries the credential snapshot so the business sees the same chips.
3. Choose scope (recurring posts): apply to the **whole series** or select **specific dates**.
4. Optional message → submit → `applications` row (`source: watch_alert|search|invite`), `profile_access_grants` row auto-created (credentials + portfolio now visible to this org), thread created. **[notify business: application_received]**
5. Provider can withdraw any time before acceptance.

## 8. Messaging

1. Threads exist only in context (opportunity + provider + org). Participants: the provider + org members who open it.
2. Both sides can message **before** booking. Composer shows a standing notice: *"Do not share patient information. Keep contact details on-platform until booking is confirmed."*
3. Pre-reveal, a regex screens outgoing messages for phone/email patterns → sender sees a warning; message sends but is flagged (`contact_flagged`) for admin visibility. Post-confirmation (`contact_revealed_at` set), no flagging; contact cards unlock.
4. System messages mark milestones in-thread (applied, offered, confirmed, canceled).
5. Admins can open any thread for support/reports/disputes — every admin thread view is **[audit]**-logged.

## 9. Booking confirmation

1. Business reviews applicants (profiles, credential chips, portfolio via grant, messages) → selects a provider: for the series, or for specific dates → application `offered`/`accepted`. **[notify provider: application_selected]**
2. Provider confirms → both sides shown the platform terms/boilerplate (versioned click-through; body frozen on the booking) → both accept → `bookings` row `confirmed`, `booking_occurrences` rows per scope, `contact_revealed_at` set on the thread. **[notify both: booking confirmed]** **[audit]**
3. Other applicants for now-filled occurrences are notified and their applications closed when `slot_count` is reached.
4. **[worker: booking-reminders]** sends T-24h and T-2h reminders per occurrence to both sides.

## 10. Completion, cancellation, no-show, occurrence changes

**Completion:** after an occurrence ends, business marks complete (or confirms the prompt) → `booking_occurrences.status = completed` → `completion_records` row (amount = booked terms; editable units for hourly/per-treatment) → both sides see the completion/invoice record. **No payment is processed.** **[notify]**

**Cancellation:** either side cancels series or single occurrence → status `canceled_by_provider` / `canceled_by_business` (admin: `canceled_by_admin`), reason captured, occurrence reopens (`open`) if in the future → counterparty notified. Repeat-cancellation data is retained for future policy. **[notify]** **[audit]**

**No-show:** after a missed occurrence, the counterparty reports it → `no_show_provider` / `no_show_business` + notes; admin can review/adjust → `disputed` if contested. MVP records and surfaces; it does not adjudicate.

**Occurrence change:** business edits a booked occurrence's time → provider asked to re-confirm; decline → that occurrence cancels (business-initiated) and reopens.

## 11. Admin credential review

1. Admin queue sorted by service **risk tier** (injectables/laser first), then submission age. Filters: status, provider type, expiring/expired.
2. Admin opens an item → metadata + document via **5-minute signed URL** (issuance → `document_access_logs`).
3. Decision: `admin_reviewed` (✓), `rejected_needs_info` (reason required), or leave `needs_review`. **[notify provider: credential_reviewed]** **[audit]**
4. Review is **asynchronous and non-blocking**: providers operate while pending; the chip simply upgrades from "self-attested" to "document reviewed" — the low-friction model (rationale in [COMPLIANCE_AND_TRUST.md](COMPLIANCE_AND_TRUST.md)).

## 12. Credential expiration workflow

1. **[worker: credential-expiry-scan, daily]** finds credentials with `expires_at` within 30 days.
2. Provider notified at T-30, T-7, T-1 (in-app + email; dedup per threshold). **[notify: credential_expiring]**
3. On expiry: status chip flips to **Expired** (derived, automatic); provider notified **[credential_expired]**; matching is unaffected (warn-don't-block) but the chip appears on every application the provider submits, and businesses with active bookings involving that provider see it surfaced.
4. Provider updates the expiration date / uploads renewal → cycle resets (status returns to `document_uploaded`/`needs_review`).
5. Admin "expiring/expired" view lists affected providers for outreach.

## 13. Admin: platform management (summary)

- Tables/views over providers, businesses, users, opportunities, applications, bookings with suspend / remove-post / disable actions — each **[audit]**-logged and **[notify]**-ing affected users where appropriate.
- Notification log explorer over `notification_deliveries` (per-channel status, provider message IDs, errors).
- Reports/disputes list (flagged messages, disputed completions, no-show reports) with admin notes.
- Impersonation is **deferred** — only with explicit consent + prominent banner + full audit if ever built (see OPEN_QUESTIONS).
