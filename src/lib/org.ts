import "server-only";
import { redirect } from "next/navigation";
import { readActiveContextCookie } from "@/lib/auth/context";
import { requireOrgMember, roleAtLeast, type OrgRole } from "@/lib/auth/guards";

/**
 * The org the user is currently acting as (context-switcher cookie), with a
 * friendly redirect if their role is below `minRole`. UX only — RLS is the
 * security boundary.
 */
export async function requireActiveOrg(minRole?: OrgRole) {
  const cookieCtx = await readActiveContextCookie();
  const activeOrgId = cookieCtx?.kind === "org" ? cookieCtx.orgId : undefined;
  const { contexts, org } = await requireOrgMember(activeOrgId);
  if (minRole && !roleAtLeast(org.role, minRole)) redirect("/b");
  return { contexts, org };
}
