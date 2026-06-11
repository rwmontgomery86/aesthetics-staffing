import "server-only";
import { redirect } from "next/navigation";
import { readActiveContextCookie } from "@/lib/auth/context";
import { requireOrgMember, roleAtLeast, type OrgRole } from "@/lib/auth/guards";

/**
 * The org the user is currently acting as (context-switcher cookie), with a
 * friendly redirect if their role is below `minRole`. UX only — RLS is the
 * security boundary.
 *
 * The cookie is validated against THIS user's memberships (mirroring
 * resolveActiveContext): a stale cookie left by another account on the same
 * browser must fall back to the first org, not redirect-loop /b (found in
 * the Phase 7 live walkthrough).
 */
export async function requireActiveOrg(minRole?: OrgRole) {
  const cookieCtx = await readActiveContextCookie();
  const { contexts } = await requireOrgMember();
  const cookieOrgId = cookieCtx?.kind === "org" ? cookieCtx.orgId : undefined;
  const org = contexts.orgs.find((o) => o.id === cookieOrgId) ?? contexts.orgs[0];
  if (minRole && !roleAtLeast(org.role, minRole)) redirect("/b");
  return { contexts, org };
}
