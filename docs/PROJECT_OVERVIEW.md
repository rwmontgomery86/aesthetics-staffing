# PROJECT_OVERVIEW

> **Working name:** OpenChair (tentative — not legally cleared; see [BRAND_AND_COPY_NOTES.md](BRAND_AND_COPY_NOTES.md)).

## Product vision

A criteria-based, geo-alert opportunity marketplace for the aesthetics, beauty, spa, med spa, and wellness industry — launching Georgia-first. The product fills **open chairs, shifts, and roles** by matching businesses that need coverage with qualified individual providers, based on geography, services, credentials, availability, and pay preferences.

The defining concept (inherited from NotifEyes) is the **watch zone**: a provider says, "I'll travel within this radius or polygon, I offer these services, I hold these credentials, I want at least this pay, I'm available at these times — notify me when a matching opportunity posts." A business says, "I need this type of provider, at this location, for this opportunity type, at this schedule, with this pay." When the two intersect, the provider is alerted — in-app, by email, and by SMS for urgent same-day needs.

This is **not a job board** the provider has to check, and not a social network. It is an alert engine with a marketplace attached.

## Target users

### Providers (supply side) — individuals only in V1

| Category | Notes |
|---|---|
| Injectors | License types in V1: RN, APRN/NP, PA, MD, DO |
| Aestheticians | GA esthetician / master cosmetologist licensure context |
| Laser technicians | Often overlapping with aesthetician credentials |
| Massage therapists | GA LMT licensure |
| Makeup artists | Typically certification/portfolio-driven, not state-licensed |
| Wellness providers | Catch-all for IV hydration, health coaching, etc. — taxonomy-extensible |

A provider can hold multiple categories (e.g., an RN injector who is also a certified laser technician). Staffing **agencies are out of scope for V1** — accounts represent one human.

### Businesses (demand side) — organizations with locations and teams

Spas, med spas, dermatology practices, plastic surgery practices, wellness clinics, salons, massage studios, makeup/event companies, training centers, and other aesthetic/wellness businesses. Product language is deliberately broad: **"business," "organization," "location"** — never just "practice."

A business account is an **organization** that can have multiple **locations**, multiple **team members** with roles (owner / admin / poster), a provider-facing internal profile, and (where appropriate) a public SEO presence.

### Platform admin

Present from day one: credential review, user/org/opportunity/booking management, notification logs, audit logs, suspension, dispute notes.

## Core concept: the watch-zone alert loop

1. A business posts an opportunity at a location with type, schedule, services, required provider type/credentials, and pay (visible — see pay rules below).
2. A background worker matches the post against every active watch zone: geography first (PostGIS), then provider type, services, opportunity type, pay floor, and availability.
3. Each matching provider gets exactly one alert per opportunity, labeled **Exact match** or **Close match**, on the channels they chose. Urgent same-day posts trigger SMS for providers who opted in.
4. The provider views details, applies (to the whole series or specific dates, for recurring posts), and messages the business in-context.
5. The business reviews applicants, messages, selects; both sides confirm; contact details unlock; the booking is created.
6. After the work, the business marks it complete; the system writes a completion/invoice record. **No money moves through the platform in MVP.**

## Core workflows

**Provider:** sign up → create provider profile → choose categories → add services → add credentials/licenses/certifications with expiration dates and documents → set pay preferences → set availability → create watch zones (radius / polygon / city / ZIP) → set notification preferences → receive alerts → view opportunity → apply or express interest → message → confirm booking → see booked / completed / canceled / past opportunities.

**Business:** sign up → create organization → add locations → invite team members → post opportunity → matching providers alerted automatically → review applicants → message → select provider → provider confirms → both sides accept platform terms → booking confirmed → mark complete → completion/invoice record created.

Full step-by-step detail in [USER_FLOWS.md](USER_FLOWS.md).

## Key product rules

- **Pay visibility is mandatory for shift-family posts** (one-time shift, recurring shift, urgent coverage, pop-up, contract coverage): fixed rate, range, or negotiable-with-minimum-shown. Full-time/permanent roles are encouraged but not forced to show ranges. There is **no bidding**: providers never see other providers' rates; businesses never see an auction board. Matching is compatibility-based, not price-race-based.
- **Credentials warn, never hard-block (MVP).** Missing/expired/self-attested-only credentials are clearly flagged to both provider and business, especially for higher-risk services. The schema supports future hard-blocking rules by service/category/state.
- **Privacy by default.** No patient information anywhere. Provider profiles are never publicly indexed. Credential documents and portfolios are private; portfolios are visible only to businesses the provider has applied to or explicitly approved. Current employer is not shown. Providers can hide themselves from business search.
- **Recurring opportunities are first-class.** A provider applies once to a recurring parent post; the business can accept for the whole series or specific dates; the system manages individual occurrences behind the scenes.

## MVP definition

Georgia-only launch with the full core loop: provider onboarding with credentials and watch zones; business onboarding with organizations, locations, and teams; opportunity posting (one-time, recurring, part-time, full-time, contract, pop-up; training and room-rental visible as "coming soon"); rule-based exact/close matching with in-app/email/SMS alerts; applications; context-bound messaging with contact masking; dual-confirmation bookings; cancellation/no-show tracking; completion/invoice records (no payment processing); admin dashboard with credential review and audit logs; public SEO landing/category/city pages. Free at launch. Precise boundaries in [MVP_SCOPE.md](MVP_SCOPE.md).

## Future vision (explicitly not MVP)

- **Education/CE, training events, room rental** — modeled as opportunity types now, UI-gated as "coming soon."
- **Payments** — Stripe processing, booking fees, subscriptions, paid posts, payouts, refunds. The schema is payment-ready (completion records, nullable Stripe columns) but nothing processes money in MVP.
- **Public reviews/ratings** — schema exists with deny-all access; no UI in MVP.
- **Native mobile apps** (V2) — V1 is mobile-responsive web.
- **Multi-state expansion** — the data model is state-aware (state-scoped credentials and requirements, geo reference tables per state) so adding states is data + legal review, not a rebuild.
- **Automated credential verification** (license-board integrations), staffing-agency accounts, AI-assisted matching.

## What this is not

- **Not a LinkedIn-style professional network.** No feeds, follows-as-content, endorsements, or public résumés. Favorites exist only to streamline repeat staffing.
- **Not a bidding/auction marketplace.** No public rate competition, ever.
- **Not an employer of record, staffing agency, or payroll provider.** Businesses and providers contract and pay each other directly, off-platform, in MVP.
- **Not a compliance authority.** The platform stores and surfaces credential information; it does not grant legal clearance. Businesses must independently verify provider eligibility. See [COMPLIANCE_AND_TRUST.md](COMPLIANCE_AND_TRUST.md).
- **Not a patient-data system.** Patient information is prohibited in messages, notes, documents, and portfolios.
