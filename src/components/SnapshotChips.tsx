import type { CredentialSnapshotChip } from "@/lib/credentials/requirements";

/**
 * Renders apply-time credential chips — both live (provider previewing an
 * application) and frozen (business reviewing the stored snapshot). Same
 * labels both sides, per the warn-don't-block compliance posture.
 */

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  not_provided: { text: "Not provided", tone: "bg-danger/10 text-danger" },
  self_attested: { text: "Self-attested", tone: "bg-blush/30 text-blush-deep" },
  document_uploaded: { text: "Document on file", tone: "bg-lilac/10 text-lilac" },
  needs_review: { text: "Document on file — review pending", tone: "bg-lilac/10 text-lilac" },
  admin_reviewed: { text: "Document reviewed", tone: "bg-success/10 text-success" },
  rejected_needs_info: { text: "Needs more info", tone: "bg-danger/10 text-danger" },
};

export function SnapshotChips({ chips }: { chips: CredentialSnapshotChip[] }) {
  if (chips.length === 0) {
    return <p className="text-sm text-ink-soft">No specific credentials are listed for this work.</p>;
  }
  return (
    <ul className="space-y-2">
      {chips.map((chip) => {
        const status = STATUS_LABEL[chip.status] ?? STATUS_LABEL.not_provided;
        return (
          <li key={chip.credentialTypeId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{chip.name}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.tone}`}>
              {status.text}
            </span>
            {chip.derived === "expired" ? (
              <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">
                Expired
              </span>
            ) : chip.derived === "expiring_soon" ? (
              <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">
                Expires soon
              </span>
            ) : null}
            {chip.level ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  chip.level === "required" ? "bg-ink/10 text-ink" : "bg-ink/5 text-ink-soft"
                }`}
              >
                {chip.level === "required" ? "Required" : "Recommended"}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
