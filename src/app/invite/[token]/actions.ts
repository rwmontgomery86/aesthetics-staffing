"use server";

import { redirect } from "next/navigation";
import { eq, isNull, and } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { organizationInvites, organizationMembers } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { writeActiveContextCookie } from "@/lib/auth/context";
import { hashInviteToken } from "@/lib/invite-token";

/**
 * Joins the org an invite points at. RLS does the heavy lifting: the invite
 * row is only visible when the signed-in email matches, and the membership
 * INSERT is only allowed for a live invite with the SAME role. The token just
 * locates the row.
 */
export async function acceptInviteAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/me");
  const tokenHash = hashInviteToken(token);

  const orgId = await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const [invite] = await tx
      .select()
      .from(organizationInvites)
      .where(eq(organizationInvites.tokenHash, tokenHash));

    // Visible-but-unusable cases re-render the status page, which explains
    // them. The email check is load-bearing: org admins can SEE all of their
    // org's invites, but accepting someone else's would consume it.
    if (
      !invite ||
      invite.acceptedByUserId ||
      invite.expiresAt < new Date() ||
      invite.email.toLowerCase() !== (user.email ?? "").toLowerCase()
    ) {
      redirect(`/invite/${token}`);
    }

    try {
      await tx.insert(organizationMembers).values({
        organizationId: invite.organizationId,
        userId: user.id,
        role: invite.role,
        invitedByUserId: invite.invitedByUserId,
        acceptedAt: new Date(),
      });
    } catch (err) {
      // Already a member (e.g. re-invited at a different role): keep their
      // existing membership, just consume the invite.
      const message = err instanceof Error ? err.message : "";
      if (!message.includes("duplicate key")) throw err;
    }

    await tx
      .update(organizationInvites)
      .set({ acceptedByUserId: user.id })
      .where(and(eq(organizationInvites.id, invite.id), isNull(organizationInvites.acceptedByUserId)));

    return invite.organizationId;
  });

  await writeActiveContextCookie({ kind: "org", orgId });
  redirect("/b?notice=" + encodeURIComponent("Welcome to the team!"));
}
