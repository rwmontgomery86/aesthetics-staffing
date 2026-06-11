import { brand } from "./brand";

/**
 * Booking terms click-through (NotifEyes contract pattern): the body is a
 * versioned template, and the version string is FROZEN onto each booking at
 * confirmation (bookings.terms_version) so we always know exactly which text
 * both parties accepted, even after this file changes.
 *
 * DRAFT COPY — placeholder until attorney review (COMPLIANCE_AND_TRUST §8).
 * Bump TERMS_VERSION on ANY wording change; never edit a published version's
 * meaning in place.
 */
export const TERMS_VERSION = "2026-06-draft-1";

export const TERMS_TITLE = "Booking terms";

export const TERMS_BODY = `${brand.name} is a marketplace that connects businesses and independent providers. It is not a party to the working arrangement you are confirming.

By confirming this booking, the business agrees that it is responsible for independently verifying the provider's licensure, certification, and eligibility to perform the services requested; for ensuring any required supervision, delegation, or medical-director arrangements are in place; for properly classifying the working relationship (employee vs. independent contractor); and for paying the provider directly under the terms agreed between the parties.

By confirming this booking, the provider agrees that they hold the licenses and credentials they have represented on their profile, that they will work within the scope of their license and applicable Georgia law, and that they will follow the business's reasonable workplace policies while on site.

Both parties agree to keep patient information off the platform, to honor the dates and times confirmed here (or cancel as early as possible), and to resolve pay and scheduling questions directly with each other. ${brand.name} does not process payments, does not guarantee either party's performance, and records completion details solely for the parties' own records.

This is placeholder text pending legal review and will be replaced before public launch.`;
