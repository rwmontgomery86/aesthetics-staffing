# BRAND_AND_COPY_NOTES

## Working name policy

**"OpenChair" is a tentative working name. It is not legally cleared.** Until a trademark search and final decision happen:

- No brand name in: database identifiers, bucket names, repo name, package name, queue names, table/column names, environment variable *names* (values are fine), or third-party account slugs where avoidable. Use a neutral codename (e.g., the repo's `aesthetics-staffing`) for infrastructure.
- No purchased domains baked into code; `APP_BASE_URL` env only.
- No logo/brand-asset spend; placeholder wordmark only.
- No trademark-sensitive public copy (taglines on social, ads) before clearance.

## Rebrandability checklist (architecture requirement)

The brand must be changeable in one sitting:

| Surface | Mechanism |
|---|---|
| App chrome, titles, nav | `src/config/brand.ts` exports `{ name, shortName, supportEmail, legalEntityPlaceholder, social }` fed by `NEXT_PUBLIC_APP_NAME` etc. |
| Emails | Templates take `brand` as a parameter; `EMAIL_FROM` env; no name in template literals |
| SMS | Sender copy composed from brand config; Twilio sender registration is the one external rename step |
| Metadata/SEO/OG | Generated from brand config + `APP_BASE_URL`; JSON-LD organization name from config |
| Legal pages | Entity name token replaced at attorney-copy time |
| CI check | Phase 10 "rebrand drill": grep CI step fails on hard-coded brand strings outside `brand.ts`/env |

NotifEyes counter-example to avoid: its name appears in env var names (`NOTIFEYES_LAUNCH_METRO`), email templates, and the geocoder user-agent. Ours go through config.

## Voice & tone

Professional · medical-adjacent · polished · slightly luxury · trustworthy · modern · functional. In practice:

- **Calm competence, not hype.** "You'll be notified the moment a matching shift posts." — not "Never miss out!!"
- **Respect both sides' professionalism.** Providers are licensed professionals, not "gig workers"; businesses are practices/studios with standards, not "buyers."
- **Precise about trust.** Credential language is exact ("document reviewed," "self-attested") — never inflated ("verified pro!"). Trust is earned by precision.
- **Quiet luxury in design, plain clarity in copy.** The aesthetic can be elevated (whitespace, refined type, restrained palette); the words stay simple and concrete.
- **Warm but not chummy.** First person plural sparingly; no exclamation-mark enthusiasm in transactional surfaces.

Distinct visual identity required — shares architectural DNA with NotifEyes, not its look (NotifEyes' navy/cyan utility aesthetic is the wrong register; OpenChair should feel like a high-end practice: warm neutrals, editorial type, generous spacing — to be designed in Phase 2/10).

## Tagline directions (exploratory — not cleared, not final)

- "Fill the chair." / "Every chair filled."
- "Coverage, the moment you need it."
- "Georgia's aesthetic staffing network."
- "The right provider, in range, on time."
- "Where open chairs meet open schedules."

## Landing page positioning (MVP)

- **Hero:** dual-audience split — "Find aesthetic shifts near you" / "Fill your open chair" — with the watch-zone map as the hero visual (the differentiator, shown not told).
- **How it works:** three steps per side (draw your zone → get alerted → book / post → matched providers alerted → confirm).
- **Trust strip:** credential transparency, private documents, no bidding, Georgia-first.
- **Provider-type and city sections** linking into the programmatic SEO pages.
- **Honest MVP framing:** free at launch; payments handled directly between you.

## Terminology (use consistently in UI, code, and docs)

| Use | Not |
|---|---|
| **Opportunity** | gig, job (except SEO copy where "jobs" matches search intent), listing |
| **Provider** | worker, freelancer, talent, contractor (UI) |
| **Business / organization / location** | practice (too medical-specific), client, employer |
| **Watch zone** | alert area, search radius, geofence |
| **Exact match / Close match** | perfect match, partial match |
| **Booking** | engagement, contract |
| **Occurrence / date** (recurring) | instance, session |
| **Credential** (umbrella: license, certification, insurance) | document (the file is the document; the credential is the fact) |
| **Self-attested / Document reviewed** | verified, approved, certified |
| **Urgent** | emergency, STAT |
| **Complete / completion record** | invoice (until payments exist; the record *generates* an invoice number but isn't a bill) |

SEO pages may additionally use search-intent vocabulary ("aesthetic nurse injector jobs in Atlanta") — marketing copy can meet searchers where they are while product UI stays on-terminology.

## Email/SMS copy principles

- Subject lines: concrete and scannable — "Exact match: Injector shift in Buckhead, $95/hr, Sat Jun 20."
- SMS: ≤160 chars where possible, brand short-name prefix, always actionable link, STOP notice per compliance.
- All transactional templates parameterized by brand config (rebrand checklist above).
