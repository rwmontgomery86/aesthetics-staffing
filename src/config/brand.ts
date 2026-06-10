/**
 * Single source of truth for brand identity. The working name is TENTATIVE and
 * not legally cleared — every user-visible surface (app chrome, emails, SMS,
 * metadata, SEO) must read from here or from NEXT_PUBLIC_APP_NAME, never from
 * a string literal. CI greps for stray hard-coded brand strings (Phase 10).
 *
 * Client-safe: no server-only imports.
 */
export const brand = {
  name: process.env.NEXT_PUBLIC_APP_NAME ?? "OpenChair",
  /** Short form for SMS prefixes and tight UI; falls back to name. */
  shortName: process.env.NEXT_PUBLIC_APP_SHORT_NAME ?? process.env.NEXT_PUBLIC_APP_NAME ?? "OpenChair",
  /** Tagline is placeholder copy until the name/brand is finalized. */
  tagline: "Georgia's geo-alert staffing marketplace for aesthetics & wellness",
} as const;
