"use server";

import { redirect } from "next/navigation";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { dbAs, type Tx } from "@/db/client";
import { organizationInvites, organizationMembers } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { requireOrgRole } from "@/lib/auth/guards";
import { newInviteToken } from "@/lib/invite-token";

const INVITE_TTL_DAYS = 14;

function fail(message: string): never {
  redirect(`/b/team?error=${encodeURIComponent(message)}`);
}

/** Owners are the only ones who may grant, revoke, or remove the owner role. */
const inviteSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("That email doesn't look right."),
  role: z.enum(["admin", "poster"]),
});

export async function inviteMemberAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const parsed = inviteSchema.safeParse({
    organizationId: formData.get("organizationId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) fail(parsed.error.issues[0].message);
  const data = parsed.data;

  await requireOrgRole(data.organizationId, "admin");
  if (user.email && data.email === user.email.toLowerCase()) {
    fail("That's your own email — you're already on the team.");
  }

  const { token, hash } = newInviteToken();

  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const [existing] = await tx
      .select({ value: count() })
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.organizationId, data.organizationId),
          eq(sql`lower(${organizationInvites.email})`, data.email),
          isNull(organizationInvites.acceptedByUserId),
          gt(organizationInvites.expiresAt, new Date()),
        ),
      );
    if (existing.value > 0) {
      fail("That email already has a pending invite — revoke it first to send a new one.");
    }

    await tx.insert(organizationInvites).values({
      organizationId: data.organizationId,
      email: data.email,
      role: data.role,
      tokenHash: hash,
      invitedByUserId: user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    });
  });

  // The plaintext token rides the redirect once so the page can show the
  // copyable link; only its hash is in the database. Safe to expose to the
  // inviting admin — acceptance still requires signing in as the invited email.
  redirect(`/b/team?invite=${token}`);
}

const revokeSchema = z.object({
  organizationId: z.string().uuid(),
  inviteId: z.string().uuid(),
});

export async function revokeInviteAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = revokeSchema.safeParse({
    organizationId: formData.get("organizationId"),
    inviteId: formData.get("inviteId"),
  });
  if (!parsed.success) fail("Invalid invite.");
  const data = parsed.data;

  await requireOrgRole(data.organizationId, "admin");
  await dbAs({ id: user.id, email: user.email }, (tx) =>
    tx
      .delete(organizationInvites)
      .where(
        and(
          eq(organizationInvites.id, data.inviteId),
          eq(organizationInvites.organizationId, data.organizationId),
        ),
      ),
  );
  redirect("/b/team?notice=" + encodeURIComponent("Invite revoked."));
}

async function ownerCount(tx: Tx, organizationId: string): Promise<number> {
  const [owners] = await tx
    .select({ value: count() })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, "owner"),
      ),
    );
  return owners.value;
}

async function memberRole(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<"owner" | "admin" | "poster" | null> {
  const [member] = await tx
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    );
  return member?.role ?? null;
}

const roleChangeSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["owner", "admin", "poster"]),
});

export async function changeMemberRoleAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = roleChangeSchema.safeParse({
    organizationId: formData.get("organizationId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) fail("Invalid role change.");
  const data = parsed.data;

  const { org } = await requireOrgRole(data.organizationId, "admin");

  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const currentRole = await memberRole(tx, data.organizationId, data.userId);
    if (!currentRole) fail("That person isn't on the team anymore.");
    if (currentRole === data.role) fail("They already have that role.");

    // Owner-role changes (in either direction) are owner-only decisions.
    if ((currentRole === "owner" || data.role === "owner") && org.role !== "owner") {
      fail("Only an owner can change who owns the business.");
    }
    if (currentRole === "owner" && (await ownerCount(tx, data.organizationId)) <= 1) {
      fail("A business needs at least one owner — promote someone else to owner first.");
    }

    await tx
      .update(organizationMembers)
      .set({ role: data.role })
      .where(
        and(
          eq(organizationMembers.organizationId, data.organizationId),
          eq(organizationMembers.userId, data.userId),
        ),
      );
  });

  redirect("/b/team?notice=" + encodeURIComponent("Role updated."));
}

const removeSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function removeMemberAction(formData: FormData) {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const parsed = removeSchema.safeParse({
    organizationId: formData.get("organizationId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) fail("Invalid removal.");
  const data = parsed.data;
  const removingSelf = data.userId === user.id;

  // Anyone may leave; removing someone else takes admin.
  const { org } = removingSelf
    ? await requireOrgRole(data.organizationId, "poster")
    : await requireOrgRole(data.organizationId, "admin");

  await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const targetRole = await memberRole(tx, data.organizationId, data.userId);
    if (!targetRole) fail("That person isn't on the team anymore.");
    if (targetRole === "owner" && !removingSelf && org.role !== "owner") {
      fail("Only an owner can remove an owner.");
    }
    if (targetRole === "owner" && (await ownerCount(tx, data.organizationId)) <= 1) {
      fail(
        removingSelf
          ? "You're the only owner — promote someone else to owner before leaving."
          : "A business needs at least one owner.",
      );
    }

    await tx
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, data.organizationId),
          eq(organizationMembers.userId, data.userId),
        ),
      );
  });

  if (removingSelf) {
    // The context cookie may still point at the org just left;
    // resolveActiveContext drops invalid cookies on the next request.
    redirect("/me?notice=" + encodeURIComponent("You've left the business."));
  }
  redirect("/b/team?notice=" + encodeURIComponent("Member removed."));
}
