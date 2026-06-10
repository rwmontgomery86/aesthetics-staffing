# MVP_SCOPE

> Working name OpenChair is tentative. Scope below assumes Georgia-only launch, free at launch, no payment processing.

## Included in MVP

| Area | Scope |
|---|---|
| Accounts & roles | Supabase Auth sign-up/login; one user can be a provider AND a business member AND (internally) a platform admin; org teams with owner/admin/poster roles; invites |
| Provider profile | Categories (multi), services, bio, years of experience, pay preferences + accepted pay structures, availability, travel radius, urgent availability + "available today/this week" status, optional photo and social handles, visibility settings (incl. hide from business search) |
| Credentials | License type/number/issuing state/board/expiration, certifications, document upload to private storage, self-attestation, statuses through admin review, expiration warnings; warn-don't-block |
| Portfolio | Upload before/after images; visible only to businesses the provider applied to or approved; rights/consent attestation; never public |
| Watch zones | Multiple zones per provider; radius, drawn polygon, city, ZIP; filters: opportunity types, services, min pay, days/time window, urgent-only; per-zone channel selection; pause |
| Business profile | Org name/type/description/website/phone, multiple locations (each geocoded, with timezone), services offered, equipment/devices, products/brands, supervision/medical-director context, dress code, parking/location notes, software/EMR/POS, team management, internal notes/admin flags, public SEO slug where appropriate |
| Opportunities | Types: one-time shift, recurring shift, part-time, full-time, contract, pop-up event, evergreen application; training event + room rental visible as "coming soon" only. Fields per the brief incl. pay structure (hourly/daily/per-treatment/commission/salary/negotiable-with-minimum), expected volume, equipment, products/brands, supervision context, liability expectations, application deadline, auto-expiration, urgent flag |
| Pay visibility | Enforced at the schema level for shift-family posts: fixed, range, or negotiable-with-minimum. No bidding surface anywhere |
| Matching & alerts | Rule-based exact/close classification; one alert per opportunity per provider; channel preferences (exact-only vs exact+close, urgent, email, SMS, in-app); urgent same-day → SMS by default for opted-in providers |
| Recurring model | Parent post + occurrences; apply once; accept for series or specific dates; occurrence-level changes manageable |
| Applications & bookings | Statuses through selection, dual confirmation, terms acceptance; canceled-by-provider/business/admin, no-show both directions, disputed completion, admin notes |
| Completion | Business marks complete; basic completion/invoice record (amount, units, structure) — **no money movement** |
| Messaging | In-app, tied to opportunity/application/booking; pre-booking messaging allowed; email/phone hidden until booking confirmed (regex warn-and-flag); patient-info warnings; admin can review threads for support/reports/disputes |
| Notifications | In-app + email (Resend) + SMS (Twilio); per-category preferences; unsubscribe controls incl. SMS STOP; per-channel delivery logs with provider message IDs and webhook status updates |
| Favorites | Provider ↔ business favorites, both directions; blocks both directions (excluded from matching) |
| Admin | Manage providers/businesses/users/opportunities/applications/bookings; credential review queue (reviewed/rejected/needs-info); expiring/expired credential views; notification logs; remove/disable posts; suspend users; reports/disputes view; audit logs; sensitive-document access only via logged signed-URL issuance |
| Public SEO | Landing page; Georgia aesthetic-staffing page; provider-type pages; city/region pages; business-type pages; opportunity-type pages; metadata/slug architecture; programmatic SEO from the services/geo taxonomies. Provider profiles and portfolios are never indexed |
| Testing | Vitest units (matching scoring, state machines), RLS/security tests, integration tests for matching, Playwright spine e2e, worker tests, migration safety checks |

## Excluded from MVP (deliberately)

- Payment processing of any kind: Stripe integration, booking fees, deposits, payouts, refunds, subscriptions, paid posts.
- Public reviews/ratings (schema exists, deny-all, no UI).
- Check-in/check-out and timesheets.
- Staffing-agency accounts; multi-provider group applications.
- Built-out training-event and room-rental workflows (types exist; UI says "coming soon").
- Automated license-board verification (Verifiable/Medallion-style) — admin review is manual.
- Native mobile apps; push notifications (web or native).
- Real-time chat presence/typing indicators; group threads; social features.
- Dispute *resolution* workflows beyond status + admin notes.
- AI/ML match scoring; recommendation feeds.
- Public bidding or rate transparency between providers.
- States other than Georgia (model is multi-state-ready; launch is GA-only).

## Deferred to V2+

| Feature | Trigger to build |
|---|---|
| Stripe (fees, subscriptions, paid posts, payouts) | Monetization decision post-launch; schema already carries completion records + nullable Stripe IDs |
| Reviews/ratings or private feedback | Enough completed bookings for signal; product decision on blind vs. private |
| Training events & room rental | Demand from training centers; mostly UI work since types are modeled |
| Supabase Realtime in-app delivery | If 25s polling feels slow; schema needs no change |
| Automated credential verification | Admin review workload exceeds capacity |
| Additional states | Legal review per state + geo data load + requirement seed rows |
| Native mobile (React Native; Supabase Auth carries over) | Post-launch traction |
| Check-in/out | Columns added to `booking_occurrences` when needed |

## Acceptance criteria (MVP "done")

**Provider side**
- A new provider can complete onboarding to a usable profile in under 10 minutes without uploading any document (self-attest path), and is clearly warned about what's missing.
- A provider can create each of the four watch-zone kinds on a map UI and see them re-rendered correctly after save.
- Posting a matching opportunity produces an in-app alert and (if opted in) an email within 60 seconds, labeled Exact or Close; an urgent same-day post produces an SMS to urgent-opted-in providers.
- A provider receives exactly one alert per opportunity regardless of how many of their zones match or how many occurrences exist.
- A provider can apply to a recurring post once, message the business, confirm a booking, and see it under Booked; past/canceled/completed lists are accurate.
- A provider with `exact-only` preference never receives close-match alerts.

**Business side**
- A business can create an org, add a second location, and invite a teammate who can post but not manage members (poster role).
- Posting flow enforces pay visibility for shift-family types and shows an estimated "providers watching this area" count before posting.
- The business can accept a provider for an entire series or only specific dates, and reschedule a single occurrence without breaking the series.
- Contact details are hidden in messaging until the booking is confirmed, then revealed to both sides.
- Credential chips on applicants accurately reflect status (self-attested / reviewed / expiring / expired / missing-required).

**Admin**
- Admin can review a credential document via a time-limited signed URL (access logged), set reviewed/rejected/needs-info, and the provider is notified.
- Credential expiration produces T-30/T-7/T-1 notifications and surfaces in the admin expiring view.
- Every admin mutation (review, suspend, remove post) writes an audit-log row.

**Security/privacy**
- RLS tests prove: a provider cannot read another provider's credentials, portfolio, applications, or rates; a business member cannot read another org's applicants; messages are participant-only; audit logs are admin-only.
- Credential/portfolio files are unreachable by URL guessing; access requires an authenticated signed-URL issuance that is logged.
- Provider profile pages return `noindex` and are absent from the sitemap.

**Quality bar**
- All Playwright spine tests green in CI; Vitest matching/state suites green; `tsc --noEmit` clean; production deploy on Vercel + Railway + Supabase with seeded demo data.

## MVP success definition

The launch bar is: **aesthetically pleasing and well functional.** Concretely — the product looks professional, polished, slightly luxury, and trustworthy on mobile and desktop (see BRAND_AND_COPY_NOTES), and the core loop (post → match → alert → apply → message → book → complete) works end-to-end reliably for real Georgia providers and businesses without manual intervention. Liquidity targets, monetization, and growth metrics are post-MVP concerns.
