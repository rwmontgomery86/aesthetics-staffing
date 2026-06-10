# COMPLIANCE_AND_TRUST

> **This document is a planning aid, not legal advice.** All suggested language below is draft boilerplate that **must be reviewed by an attorney** before any real user sees it. Items requiring attorney review are collected in §8.

## 1. Posture

The platform is a **neutral marketplace and alert engine**. It stores credential information and surfaces it; it does not verify eligibility to practice, does not grant legal clearance, is not an employer of record, and does not provide legal or compliance advice. Businesses remain responsible for verifying provider eligibility, supervision arrangements, employment classification, and payment. Providers remain responsible for truthful credential information and active licensure. The product, copy, and schema are all designed to make this posture unmistakable.

## 2. Credential status model

Stored statuses (see DATABASE_SCHEMA): `not_provided → self_attested → document_uploaded → needs_review → admin_reviewed | rejected_needs_info`. **Expiring-soon / expired are derived from `expires_at`**, never stored, so they cannot go stale.

| Status | Meaning shown to businesses |
|---|---|
| `not_provided` | "Not provided" (red chip when required for the relevant service) |
| `self_attested` | "Self-attested — not reviewed" |
| `document_uploaded` / `needs_review` | "Document on file — review pending" |
| `admin_reviewed` | "Document reviewed by platform" — **explicitly NOT "verified eligible to practice"** |
| `rejected_needs_info` | Provider-facing only; businesses see "Not provided" until resolved |
| derived expiring/expired | Overlaid on any status: "Expires in N days" / "Expired" |

UI language matters: the reviewed state must say "document reviewed," never "license verified" or "approved to practice." The chip tooltip carries: *"Platform review confirms a document was uploaded and is facially consistent with the stated credential. Businesses must independently verify eligibility with the issuing board."*

## 3. Self-attestation model

- Any credential can be self-attested without a document (status `self_attested`, timestamped, attestation text presented at the moment of attestation and recorded by version).
- Attestation copy (draft): *"I attest that the credential information I provided is true, accurate, and current, and that I will keep it updated. I understand that businesses and the platform rely on this information and that false statements may result in removal from the platform."*
- Self-attested-only credentials are visibly labeled to businesses — this is the core honesty mechanism while review is async.

## 4. Admin review model — the low-friction recommendation

Balancing fast onboarding, trust, legal caution, admin workload, and future automation:

1. **Instant onboarding, async review.** Providers are fully usable immediately on the self-attest path. Nothing waits on an admin (the NotifEyes pending-OD gate is deliberately *not* copied — it blocked supply-side activation on a human queue).
2. **Risk-tiered queue.** `service_categories.risk_tier` (injectables/laser/IV = 3 … makeup/facials = 1) sorts the review queue: documents tied to tier-3 services first, then age. A solo admin reviews what matters most first.
3. **Review = document facial check only.** Admin confirms the upload matches the claimed credential type, name matches the profile, number/expiry are legible and recorded correctly. It is explicitly not board verification — that is V2 automation (license-board APIs / Verifiable-Medallion-style services slot in behind the same `needs_review → admin_reviewed` transition).
4. **Trust grows visibly, friction doesn't.** Each review upgrades a chip; nothing unlocks/locks. Businesses make their own calls with accurate labels.
5. **Hard-block hooks reserved.** `credential_requirements.level` gains a `blocking` value in V2 if policy (or a state) demands it — enforcement point is at apply/post time, already identified.
6. **Every review decision** writes `reviewed_by`, timestamp, notes → `audit_logs`; every document view issues a logged 5-minute signed URL → `document_access_logs`.

## 5. Patient data — prohibited

- No patient names, photos with identifying features, chart data, treatment records, or scheduling details that identify a patient — anywhere: messages, notes, opportunity descriptions, uploaded documents, portfolio images.
- Enforcement layers: composer warning text on every thread; ToS prohibition; portfolio upload attestation (*"I have the legal right and documented consent to share these images; they contain no patient-identifying information"*); admin takedown + strike on report.
- The platform does not intend to be a HIPAA business associate and must not drift into storing PHI. If a future feature would touch PHI, that is a stop-and-get-counsel moment.
- Defensive design choices supporting this: no patient-facing surfaces, no booking-for-patients features, no EMR integrations in MVP.

## 6. Suggested disclaimer/boilerplate language (drafts for attorney review)

**Platform role (footer + ToS):**
> "[Platform] is a marketplace that connects independent providers and businesses. [Platform] is not an employer, staffing agency, or employer of record, and is not a party to any engagement between providers and businesses. [Platform] does not provide legal, medical, or compliance advice."

**Business responsibility (shown at posting + booking confirmation):**
> "You are responsible for independently verifying each provider's licensure, certification, and eligibility to perform the services you request; for ensuring any required supervision, delegation, or medical-director arrangements are in place; for properly classifying the working relationship (employee vs. independent contractor); and for paying the provider directly under the terms you agree. Consult your attorney or compliance advisor."

**Provider responsibility (shown at credential entry + application):**
> "You are responsible for the truthfulness, accuracy, and currency of your credential information and for maintaining active licensure/certification required for the services you offer. Credential review by [Platform] confirms only that a document was provided; it is not a determination that you are authorized to perform any service."

**Messaging (composer, persistent):**
> "Do not share patient information. Do not request or provide patient-identifying details. Keep contact and payment arrangements consistent with platform terms."

**Documents (upload UI):**
> "Uploaded documents are private. They are used only for platform review and, where you apply to or approve a business, that business's review. They are never public."

**Booking confirmation click-through (both sides; versioned, body frozen on the booking record — NotifEyes contract pattern):** engagement summary + the above responsibility paragraphs + cancellation/no-show expectations + payment-is-off-platform statement.

## 7. Cancellation / no-show / dispute posture (MVP)

- Recorded, surfaced, not adjudicated: statuses for canceled-by-provider/business/admin, no-show both directions, disputed completion; admin notes everywhere.
- No fees of any kind in MVP (no payment rails). Boilerplate sets expectations ("cancel as early as possible; repeated late cancellations and no-shows may result in removal").
- Reliability stats are **collected but not displayed** in MVP — displaying them is a V2 product/legal decision.

## 8. Attorney review checklist

**Documents to draft/review**
- [ ] Terms of Service (marketplace role, disclaimers, prohibited conduct incl. patient data, account termination)
- [ ] Privacy Policy (credential documents, portfolios, message review by admins, delivery logs, analytics)
- [ ] Booking confirmation click-through agreement (both-sides)
- [ ] Provider credential self-attestation language; portfolio rights/consent attestation
- [ ] Cancellation/no-show policy language
- [ ] SMS consent language + STOP/HELP flows (TCPA); 10DLC campaign registration content

**Georgia regulatory questions (gate the credential-requirements seed data)**
- [ ] Injectables: who may inject under GA law (RN/APRN/PA delegation and protocol requirements, physician/medical-director supervision, on-site vs available); what the platform may *display* about supervision without advising
- [ ] Esthetician vs master cosmetologist scope (GA State Board of Cosmetology) — which services map to which license
- [ ] Laser/IPL: GA rules on who may operate cosmetic laser devices and under what supervision
- [ ] Massage: GA LMT licensure requirements (Georgia Board of Massage Therapy)
- [ ] IV hydration/wellness: GA scope and supervision rules
- [ ] Makeup artistry: confirm no GA license requirement (and where lash/brow services cross into licensed territory)
- [ ] Whether any service should be hard-blocked rather than warned in GA from day one

**Structural/classification**
- [ ] Worker-classification exposure: confirm platform design (no payment processing, no schedule control, no exclusivity) and copy don't create employer/staffing-agency characterization; review any future fee model against GA staffing-agency statutes
- [ ] Marketplace liability: review disclaimer adequacy; consider requiring businesses to attest insurance/medical-director status on injectable/laser posts (currently free-text context — see OPEN_QUESTIONS)
- [ ] Data retention: how long to keep credential documents, messages, audit logs after account deletion
- [ ] Multi-state expansion protocol: per-state legal review checklist before enabling a new state

## 9. Georgia-first, multi-state-ready

State is a first-class column on credentials, requirements, locations, and geo reference tables. Adding a state = (1) attorney review per §8, (2) seed `credential_requirements` rows for that state, (3) load `geo_zips`/`geo_cities` polygons, (4) flip availability. No schema or matching-engine changes. Requirement rows with `state IS NULL` are nationwide defaults; state rows override/extend by union.
