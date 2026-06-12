import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { asc, eq, sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  credentialDocuments,
  credentialTypes,
  providerCredentials,
  providerProfiles,
} from "@/db/schema";
import { SignedFileLink } from "@/components/SignedFileLink";
import { requireAdmin } from "@/lib/auth/guards";
import { reviewCredentialAction } from "@/app/(app)/admin/actions";

export const metadata = { title: "Review credential — admin" };

export default async function AdminCredentialDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }, contexts] = await Promise.all([
    params,
    searchParams,
    requireAdmin(),
  ]);

  const data = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const [credential] = await tx
      .select({
        id: providerCredentials.id,
        status: providerCredentials.status,
        state: providerCredentials.state,
        licenseNumber: providerCredentials.licenseNumber,
        issuingBoard: providerCredentials.issuingBoard,
        issuedAt: providerCredentials.issuedAt,
        expiresAt: providerCredentials.expiresAt,
        selfAttestedAt: providerCredentials.selfAttestedAt,
        submittedForReviewAt: providerCredentials.submittedForReviewAt,
        reviewedAt: providerCredentials.reviewedAt,
        reviewNotes: providerCredentials.reviewNotes,
        rejectionReason: providerCredentials.rejectionReason,
        typeName: credentialTypes.name,
        providerProfileId: providerProfiles.id,
        providerName: providerProfiles.displayName,
        providerUserId: providerProfiles.userId,
      })
      .from(providerCredentials)
      .innerJoin(credentialTypes, eq(credentialTypes.id, providerCredentials.credentialTypeId))
      .innerJoin(providerProfiles, eq(providerProfiles.id, providerCredentials.providerProfileId))
      .where(eq(providerCredentials.id, id));
    if (!credential) return null;

    const documents = await tx
      .select()
      .from(credentialDocuments)
      .where(eq(credentialDocuments.providerCredentialId, credential.id))
      .orderBy(asc(credentialDocuments.uploadedAt));
    const emailResult = await tx.execute<{ email: string | null }>(
      sql`select public.admin_user_email(${credential.providerUserId}::uuid) as email`,
    );
    return { credential, documents, email: emailResult.rows[0]?.email ?? null };
  });
  if (!data) notFound();
  const { credential, documents, email } = data;

  // date columns arrive as ISO strings — fromISO keeps the calendar date
  // (new Date() would parse at UTC midnight and show the previous day in ET).
  const fmtDate = (value: string | Date | null) =>
    value == null
      ? "—"
      : (value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value)).toFormat(
          "MMM d, yyyy",
        );

  return (
    <div className="max-w-2xl">
      <Link href="/admin/credentials" className="text-sm text-ink-soft hover:text-lilac">
        ← Review queue
      </Link>
      <h1 className="mt-2 text-3xl font-semibold">{credential.typeName}</h1>
      <p className="mt-1 text-ink-soft">
        {credential.providerName}
        {email ? <> · {email}</> : null}
      </p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      <section className="oc-card mt-6 p-6">
        <h2 className="text-lg font-semibold">Details as submitted</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-soft">Status</dt>
            <dd className="font-medium">{credential.status.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">State</dt>
            <dd>{credential.state ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">License number</dt>
            <dd>{credential.licenseNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Issuing board</dt>
            <dd>{credential.issuingBoard ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Issued</dt>
            <dd>{fmtDate(credential.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Expires</dt>
            <dd>{fmtDate(credential.expiresAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Self-attested</dt>
            <dd>{fmtDate(credential.selfAttestedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Submitted for review</dt>
            <dd>{fmtDate(credential.submittedForReviewAt)}</dd>
          </div>
        </dl>
        {credential.reviewedAt ? (
          <p className="mt-3 text-xs text-ink-soft">
            Last decision {fmtDate(credential.reviewedAt)}
            {credential.reviewNotes ? ` — notes: ${credential.reviewNotes}` : ""}
            {credential.rejectionReason ? ` — rejection reason: ${credential.rejectionReason}` : ""}
          </p>
        ) : null}
      </section>

      <section className="oc-card mt-4 p-6">
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Opens a 5-minute signed link; every view is written to the provider-visible access log.
        </p>
        {documents.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No documents uploaded.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{doc.fileName}</span>
                <span className="text-xs text-ink-soft">
                  {(doc.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                  {DateTime.fromJSDate(doc.uploadedAt).toFormat("MMM d")}
                </span>
                <SignedFileLink kind="credential" id={doc.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="oc-card mt-4 p-6">
        <h2 className="text-lg font-semibold">Decision</h2>
        <p className="mt-1 text-xs text-ink-soft">
          The provider is notified either way. Approving marks the chip “platform-reviewed”;
          rejecting sends it back with your reason.
        </p>
        <form action={reviewCredentialAction} className="mt-4 space-y-3">
          <input type="hidden" name="credentialId" value={credential.id} />
          <input type="hidden" name="decision" value="approve" />
          <div>
            <label className="oc-label" htmlFor="reviewNotes">
              Internal notes (optional)
            </label>
            <textarea id="reviewNotes" name="reviewNotes" rows={2} className="oc-input" />
          </div>
          <button type="submit" className="oc-btn">
            Approve — mark reviewed ✓
          </button>
        </form>
        <form action={reviewCredentialAction} className="mt-6 space-y-3 border-t border-line pt-4">
          <input type="hidden" name="credentialId" value={credential.id} />
          <input type="hidden" name="decision" value="reject" />
          <div>
            <label className="oc-label" htmlFor="rejectionReason">
              Rejection reason (sent to the provider)
            </label>
            <textarea
              id="rejectionReason"
              name="rejectionReason"
              rows={2}
              required
              className="oc-input"
              placeholder="e.g. The document is cropped — we need the full license including the expiration date."
            />
          </div>
          <button type="submit" className="oc-btn-secondary text-danger">
            Reject — needs more info
          </button>
        </form>
      </section>
    </div>
  );
}
