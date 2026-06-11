import { TERMS_BODY, TERMS_TITLE, TERMS_VERSION } from "@/config/terms";

/**
 * The versioned click-through shown to BOTH sides before they confirm a
 * booking (business at offer time, provider at accept time). The version the
 * checkbox names is the one frozen onto bookings.terms_version.
 */
export function TermsBox() {
  return (
    <div>
      <details className="rounded-lg border border-line bg-white/50 p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          {TERMS_TITLE} <span className="text-ink-soft">({TERMS_VERSION})</span>
        </summary>
        <p className="mt-2 whitespace-pre-line text-ink-soft">{TERMS_BODY}</p>
      </details>
      <label className="mt-2 flex items-start gap-2 text-sm">
        <input type="checkbox" name="termsAccepted" required className="mt-0.5" />
        <span>I&apos;ve read and accept the booking terms ({TERMS_VERSION}).</span>
      </label>
    </div>
  );
}
