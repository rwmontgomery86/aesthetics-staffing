"use server";

import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { dbAs } from "@/db/client";
import {
  opportunities,
  organizationAdminNotes,
  organizations,
  profiles,
  providerCredentials,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import { enqueueNotifyEvent, tryEnqueue } from "@/lib/queue";

/**
 * Every admin mutation in one place. The pattern, per the Phase 9 exit
 * criteria: requireAdmin() is the UX guard, RLS admin arms (and the
 * credential-review trigger) are the security boundary, and EVERY mutation
 * writes a record_audit row with acting_as 'admin' before the transaction
 * commits. Notifications to affected users go through the notify-event
 * worker — the admin's RLS connection can't write other users' rows.
 */

const uuid = z.string().uuid();

function fail(backTo: string, message: string): never {
  redirect(`${backTo}?error=${encodeURIComponent(message)}`);
}

/* ── Credential review (USER_FLOWS §11) ─────────────────────────────── */

const reviewSchema = z.object({
  credentialId: uuid,
  decision: z.enum(["approve", "reject"]),
  reviewNotes: z.string().trim().max(2000).default(""),
  rejectionReason: z.string().trim().max(2000).default(""),
});

export async function reviewCredentialAction(formData: FormData) {
  const contexts = await requireAdmin();
  const parsed = reviewSchema.safeParse({
    credentialId: formData.get("credentialId"),
    decision: formData.get("decision"),
    reviewNotes: formData.get("reviewNotes") ?? "",
    rejectionReason: formData.get("rejectionReason") ?? "",
  });
  if (!parsed.success) redirect("/admin/credentials");
  const { credentialId, decision, reviewNotes, rejectionReason } = parsed.data;
  const backTo = `/admin/credentials/${credentialId}`;
  if (decision === "reject" && !rejectionReason) {
    fail(backTo, "A rejection needs a reason the provider can act on.");
  }

  await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const [credential] = await tx
      .select({ id: providerCredentials.id, status: providerCredentials.status })
      .from(providerCredentials)
      .where(eq(providerCredentials.id, credentialId));
    if (!credential) fail("/admin/credentials", "That credential no longer exists.");

    await tx
      .update(providerCredentials)
      .set({
        status: decision === "approve" ? "admin_reviewed" : "rejected_needs_info",
        reviewedByUserId: contexts.user.id,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes || null,
        rejectionReason: decision === "reject" ? rejectionReason : null,
      })
      .where(eq(providerCredentials.id, credentialId));

    await tx.execute(sql`
      select public.record_audit('admin', 'credential.reviewed', 'provider_credential',
        ${credentialId}::uuid, null,
        ${JSON.stringify({ from: credential.status, decision, hasNotes: Boolean(reviewNotes) })}::jsonb)
    `);
  });

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "credential_reviewed", credentialId }),
    "notify-credential-reviewed",
  );
  redirect(
    `/admin/credentials?notice=` +
      encodeURIComponent(decision === "approve" ? "Marked reviewed ✓" : "Sent back for more info."),
  );
}

/* ── User suspension ────────────────────────────────────────────────── */

const suspendSchema = z.object({
  userId: uuid,
  reason: z.string().trim().min(1, "A reason is required.").max(1000),
});

export async function suspendUserAction(formData: FormData) {
  const contexts = await requireAdmin();
  const parsed = suspendSchema.safeParse({
    userId: formData.get("userId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) fail("/admin/users", parsed.error.issues[0].message);
  const { userId, reason } = parsed.data;
  if (userId === contexts.user.id) fail("/admin/users", "You can't suspend your own account.");

  await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    await tx
      .update(profiles)
      .set({ suspendedAt: new Date(), suspendedReason: reason })
      .where(eq(profiles.id, userId));
    await tx.execute(sql`
      select public.record_audit('admin', 'user.suspended', 'profile', ${userId}::uuid, null,
        ${JSON.stringify({ reason })}::jsonb)
    `);
  });
  redirect(`/admin/users?notice=${encodeURIComponent("Account suspended.")}`);
}

export async function unsuspendUserAction(formData: FormData) {
  const contexts = await requireAdmin();
  const parsed = uuid.safeParse(formData.get("userId"));
  if (!parsed.success) redirect("/admin/users");

  await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    await tx
      .update(profiles)
      .set({ suspendedAt: null, suspendedReason: null })
      .where(eq(profiles.id, parsed.data));
    await tx.execute(sql`
      select public.record_audit('admin', 'user.unsuspended', 'profile', ${parsed.data}::uuid)
    `);
  });
  redirect(`/admin/users?notice=${encodeURIComponent("Account reinstated.")}`);
}

/* ── Organization management ────────────────────────────────────────── */

export async function setOrgVerifiedAction(formData: FormData) {
  const contexts = await requireAdmin();
  const orgId = uuid.safeParse(formData.get("organizationId"));
  if (!orgId.success) redirect("/admin/organizations");
  const verified = formData.get("verified") === "true";

  await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    await tx
      .update(organizations)
      .set({ verifiedAt: verified ? new Date() : null })
      .where(eq(organizations.id, orgId.data));
    await tx.execute(sql`
      select public.record_audit('admin', ${verified ? "org.verified" : "org.unverified"},
        'organization', ${orgId.data}::uuid, ${orgId.data}::uuid)
    `);
  });
  redirect(
    `/admin/organizations?notice=` +
      encodeURIComponent(verified ? "Marked verified." : "Verification removed."),
  );
}

export async function saveOrgNotesAction(formData: FormData) {
  const contexts = await requireAdmin();
  const orgId = uuid.safeParse(formData.get("organizationId"));
  if (!orgId.success) redirect("/admin/organizations");
  const notes = String(formData.get("notes") ?? "").slice(0, 5000);

  await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    await tx
      .insert(organizationAdminNotes)
      .values({ organizationId: orgId.data, notes, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: organizationAdminNotes.organizationId,
        set: { notes, updatedAt: new Date() },
      });
    await tx.execute(sql`
      select public.record_audit('admin', 'org.notes_updated', 'organization',
        ${orgId.data}::uuid, ${orgId.data}::uuid)
    `);
  });
  redirect(`/admin/organizations?notice=${encodeURIComponent("Notes saved.")}`);
}

/* ── Post removal ───────────────────────────────────────────────────── */

const removePostSchema = z.object({
  opportunityId: uuid,
  reason: z.string().trim().max(1000).default(""),
});

export async function removePostAction(formData: FormData) {
  const contexts = await requireAdmin();
  const parsed = removePostSchema.safeParse({
    opportunityId: formData.get("opportunityId"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) redirect("/admin/opportunities");
  const { opportunityId, reason } = parsed.data;

  await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const [opp] = await tx
      .select({
        id: opportunities.id,
        status: opportunities.status,
        organizationId: opportunities.organizationId,
      })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId));
    if (!opp) fail("/admin/opportunities", "That post no longer exists.");
    if (opp.status !== "posted") {
      fail("/admin/opportunities", `Only posted opportunities can be removed (this one is ${opp.status}).`);
    }

    await tx
      .update(opportunities)
      .set({ status: "archived" })
      .where(and(eq(opportunities.id, opportunityId), eq(opportunities.status, "posted")));
    await tx.execute(sql`
      select public.record_audit('admin', 'post.removed', 'opportunity',
        ${opportunityId}::uuid, ${opp.organizationId}::uuid,
        ${JSON.stringify({ reason: reason || null })}::jsonb)
    `);
  });

  await tryEnqueue(
    () => enqueueNotifyEvent({ kind: "post_removed", opportunityId, reason: reason || null }),
    "notify-post-removed",
  );
  redirect(`/admin/opportunities?notice=${encodeURIComponent("Post removed from the marketplace.")}`);
}
