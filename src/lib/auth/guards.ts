import "server-only";
import { redirect } from "next/navigation";
import { getUserContexts, type UserContexts } from "./session";

/**
 * UX guards: friendly redirects for signed-out / wrong-hat users.
 * NOT the security boundary — that's RLS (every query runs through dbAs()).
 */

export async function requireContexts(): Promise<UserContexts> {
  const contexts = await getUserContexts();
  if (!contexts) redirect("/login");
  return contexts;
}

export async function requireProvider() {
  const contexts = await requireContexts();
  if (!contexts.provider) redirect("/onboarding");
  return { contexts, provider: contexts.provider };
}

export async function requireOrgMember(orgId?: string) {
  const contexts = await requireContexts();
  if (contexts.orgs.length === 0) redirect("/onboarding");
  const org = orgId ? contexts.orgs.find((o) => o.id === orgId) : contexts.orgs[0];
  if (!org) redirect("/b");
  return { contexts, org };
}

const ROLE_LADDER = { poster: 0, admin: 1, owner: 2 } as const;

export type OrgRole = keyof typeof ROLE_LADDER;

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ROLE_LADDER[role] >= ROLE_LADDER[min];
}

export async function requireOrgRole(orgId: string, min: OrgRole) {
  const { contexts, org } = await requireOrgMember(orgId);
  if (!roleAtLeast(org.role, min)) redirect("/b");
  return { contexts, org };
}

export async function requireAdmin() {
  const contexts = await requireContexts();
  if (!contexts.isAdmin) redirect("/me");
  return contexts;
}
