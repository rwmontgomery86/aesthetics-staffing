import { inArray } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { credentialDocuments, providerCredentials } from "@/db/schema";
import { FileUpload } from "@/components/FileUpload";
import { PrivateFileLink } from "@/components/PrivateFileLink";
import { getCredentialSummary, type CredentialChipData } from "@/lib/credentials/requirements";
import { requireProviderRow } from "@/lib/provider";
import { saveCredentialAction } from "./actions";

export const metadata = { title: "Credentials" };

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  not_provided: { text: "Not provided", tone: "bg-danger/10 text-danger" },
  self_attested: { text: "Self-attested", tone: "bg-blush/30 text-blush-deep" },
  document_uploaded: { text: "Document on file", tone: "bg-lilac/10 text-lilac" },
  needs_review: { text: "Document on file — review pending", tone: "bg-lilac/10 text-lilac" },
  admin_reviewed: { text: "Document reviewed", tone: "bg-success/10 text-success" },
  rejected_needs_info: { text: "Needs more info", tone: "bg-danger/10 text-danger" },
};

function Chip({ chip }: { chip: CredentialChipData }) {
  const status = STATUS_LABEL[chip.status];
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.tone}`}>{status.text}</span>
      {chip.derived === "expired" ? (
        <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">Expired</span>
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
    </span>
  );
}

export default async function CredentialsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { user, provider }] = await Promise.all([
    searchParams,
    requireProviderRow(),
  ]);

  const { chips, typeById, allTypes, documentsByCredential, credentialById } = await dbAs(
    user,
    async (tx) => {
      const summary = await getCredentialSummary(tx, provider.id, "GA");
      const credentialIds = summary.chips
        .map((chip) => chip.credentialId)
        .filter((id): id is string => Boolean(id));
      const documents = credentialIds.length
        ? await tx
            .select()
            .from(credentialDocuments)
            .where(inArray(credentialDocuments.providerCredentialId, credentialIds))
        : [];
      const documentsByCredential = new Map<string, typeof documents>();
      for (const doc of documents) {
        const list = documentsByCredential.get(doc.providerCredentialId) ?? [];
        list.push(doc);
        documentsByCredential.set(doc.providerCredentialId, list);
      }
      const fullCredentials = credentialIds.length
        ? await tx
            .select()
            .from(providerCredentials)
            .where(inArray(providerCredentials.id, credentialIds))
        : [];
      return {
        ...summary,
        documentsByCredential,
        credentialById: new Map(fullCredentials.map((row) => [row.id, row])),
      };
    },
  );

  const warningCount = chips.filter((chip) => chip.isWarning).length;
  const knownTypeIds = new Set(chips.map((chip) => chip.credentialTypeId));
  const addableTypes = allTypes.filter((type) => !knownTypeIds.has(type.id));

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Credentials</h1>
      <p className="mt-2 text-ink-soft">
        Based on your categories and services, here&apos;s what Georgia businesses will look for.
        Nothing here blocks you — but complete credentials make your applications stand out, and
        businesses see these same labels.
      </p>
      {warningCount > 0 ? (
        <p className="oc-error mt-4">
          {warningCount} required credential{warningCount > 1 ? "s are" : " is"} missing, expired, or
          needs info.
        </p>
      ) : null}
      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      <div className="mt-8 space-y-4">
        {chips.map((chip) => {
          const type = typeById.get(chip.credentialTypeId);
          if (!type) return null;
          const credential = chip.credentialId ? credentialById.get(chip.credentialId) : undefined;
          const documents = chip.credentialId
            ? (documentsByCredential.get(chip.credentialId) ?? [])
            : [];
          return (
            <details key={chip.credentialTypeId} className="oc-card p-5">
              <summary className="cursor-pointer list-none">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{type.name}</span>
                  <Chip chip={chip} />
                </span>
                {chip.expiresAt ? (
                  <span className="mt-1 block text-xs text-ink-soft">Expires {chip.expiresAt}</span>
                ) : null}
              </summary>

              <form action={saveCredentialAction} className="mt-5 space-y-4 border-t border-line pt-5">
                <input type="hidden" name="credentialTypeId" value={type.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  {type.requiresLicenseNumber ? (
                    <div>
                      <label className="oc-label">License / certificate number</label>
                      <input
                        name="licenseNumber"
                        defaultValue={credential?.licenseNumber ?? ""}
                        className="oc-input"
                      />
                    </div>
                  ) : (
                    <input type="hidden" name="licenseNumber" value="" />
                  )}
                  <div>
                    <label className="oc-label">Issuing board (optional)</label>
                    <input
                      name="issuingBoard"
                      defaultValue={credential?.issuingBoard ?? ""}
                      placeholder="e.g. Georgia Board of Nursing"
                      className="oc-input"
                    />
                  </div>
                  <div>
                    <label className="oc-label">Issued (optional)</label>
                    <input name="issuedAt" type="date" defaultValue={credential?.issuedAt ?? ""} className="oc-input" />
                  </div>
                  <div>
                    <label className="oc-label">
                      Expires {type.requiresExpiry ? "" : "(optional)"}
                    </label>
                    <input
                      name="expiresAt"
                      type="date"
                      required={type.requiresExpiry}
                      defaultValue={credential?.expiresAt ?? ""}
                      className="oc-input"
                    />
                  </div>
                </div>

                <div>
                  <span className="oc-label">Document {type.requiresDocument ? "" : "(optional)"}</span>
                  {documents.map((doc) => (
                    <p key={doc.id} className="mb-1 text-sm text-ink-soft">
                      {doc.fileName} · <PrivateFileLink bucket="credentials" path={doc.storagePath} />
                    </p>
                  ))}
                  <FileUpload
                    bucket="credentials"
                    userId={user.id}
                    name="document"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    label={documents.length > 0 ? "Upload newer document" : "Upload document"}
                  />
                  <p className="mt-1 text-xs text-ink-soft">
                    Documents are private — used only for platform review and businesses you apply
                    to. Never public.
                  </p>
                </div>

                <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-xs text-ink-soft">
                  <input type="checkbox" name="attest" className="mt-0.5" required />
                  <span>
                    I attest that this credential information is true, accurate, and current, and
                    that I will keep it updated. I understand businesses and the platform rely on
                    this information.
                  </span>
                </label>

                <button type="submit" className="oc-btn">
                  Save credential
                </button>
              </form>
            </details>
          );
        })}
      </div>

      {addableTypes.length > 0 ? (
        <details className="oc-card mt-8 p-5">
          <summary className="cursor-pointer list-none font-medium">
            + Add another credential
          </summary>
          <form action={saveCredentialAction} className="mt-5 space-y-4 border-t border-line pt-5">
            <div>
              <label className="oc-label">Credential</label>
              <select name="credentialTypeId" className="oc-input">
                {addableTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="oc-label">License / certificate number (optional)</label>
                <input name="licenseNumber" className="oc-input" />
              </div>
              <div>
                <label className="oc-label">Expires (optional)</label>
                <input name="expiresAt" type="date" className="oc-input" />
              </div>
            </div>
            <input type="hidden" name="issuingBoard" value="" />
            <input type="hidden" name="issuedAt" value="" />
            <div>
              <span className="oc-label">Document (optional)</span>
              <FileUpload
                bucket="credentials"
                userId={user.id}
                name="document"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                label="Upload document"
              />
            </div>
            <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-xs text-ink-soft">
              <input type="checkbox" name="attest" className="mt-0.5" required />
              <span>
                I attest that this credential information is true, accurate, and current, and that I
                will keep it updated.
              </span>
            </label>
            <button type="submit" className="oc-btn">
              Add credential
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
