"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import { credentialDocuments, providerCredentials } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { providerInTx } from "@/lib/provider";

const LAUNCH_STATE = "GA";

const schema = z.object({
  credentialTypeId: z.string().uuid(),
  licenseNumber: z.string().trim().max(80).default(""),
  issuingBoard: z.string().trim().max(120).default(""),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  attest: z.literal("on", {
    errorMap: () => ({ message: "Please confirm the attestation to save this credential." }),
  }),
});

export async function saveCredentialAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const parsed = schema.safeParse({
    credentialTypeId: formData.get("credentialTypeId"),
    licenseNumber: formData.get("licenseNumber"),
    issuingBoard: formData.get("issuingBoard"),
    issuedAt: formData.get("issuedAt") ?? "",
    expiresAt: formData.get("expiresAt") ?? "",
    attest: formData.get("attest") ?? "",
  });
  if (!parsed.success) {
    redirect("/p/credentials?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const data = parsed.data;
  const documentPath = String(formData.get("document") ?? "");
  const documentName = String(formData.get("document_filename") ?? "document");

  await dbAs(user, async (tx) => {
    const provider = await providerInTx(tx, user.id);

    const [existing] = await tx
      .select()
      .from(providerCredentials)
      .where(
        and(
          eq(providerCredentials.providerProfileId, provider.id),
          eq(providerCredentials.credentialTypeId, data.credentialTypeId),
          eq(providerCredentials.state, LAUNCH_STATE),
        ),
      );

    const existingDocs = existing
      ? await tx
          .select({ id: credentialDocuments.id })
          .from(credentialDocuments)
          .where(eq(credentialDocuments.providerCredentialId, existing.id))
      : [];

    // Status (admin decisions are trigger-protected; this only moves between
    // provider-side states): new doc → needs_review; doc already on file →
    // keep the review pipeline state; otherwise self-attested.
    const hasDocAfterSave = Boolean(documentPath) || existingDocs.length > 0;
    const keepReviewState =
      existing && ["needs_review", "admin_reviewed"].includes(existing.status) && !documentPath;
    const nextStatus = documentPath
      ? ("needs_review" as const)
      : keepReviewState
        ? existing.status
        : hasDocAfterSave
          ? ("needs_review" as const)
          : ("self_attested" as const);

    const values = {
      licenseNumber: data.licenseNumber || null,
      issuingBoard: data.issuingBoard || null,
      issuedAt: data.issuedAt || null,
      expiresAt: data.expiresAt || null,
      status: nextStatus,
      selfAttestedAt: new Date(),
      ...(documentPath ? { submittedForReviewAt: new Date() } : {}),
    };

    let credentialId: string;
    if (existing) {
      await tx.update(providerCredentials).set(values).where(eq(providerCredentials.id, existing.id));
      credentialId = existing.id;
    } else {
      const [inserted] = await tx
        .insert(providerCredentials)
        .values({
          providerProfileId: provider.id,
          credentialTypeId: data.credentialTypeId,
          state: LAUNCH_STATE,
          ...values,
        })
        .returning({ id: providerCredentials.id });
      credentialId = inserted.id;
    }

    if (documentPath) {
      await tx.insert(credentialDocuments).values({
        providerCredentialId: credentialId,
        storagePath: documentPath,
        fileName: documentName,
        mimeType: documentPath.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
        sizeBytes: 0, // size enforced client-side + by the bucket limit
      });
    }
  });

  redirect("/p/credentials?notice=" + encodeURIComponent("Credential saved."));
}
