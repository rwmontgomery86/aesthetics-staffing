import { redirect } from "next/navigation";
import { getUserContexts } from "@/lib/auth/session";
import {
  contextHomePath,
  readActiveContextCookie,
  resolveActiveContext,
} from "@/lib/auth/context";

/**
 * Post-login traffic cop: route to the active hat's home, or onboarding.
 *
 * Deliberately does NOT persist the resolved context — pages can't modify
 * cookies in Next (only Server Actions / Route Handlers can), and it isn't
 * needed: resolveActiveContext re-derives the hat on every request, and the
 * cookie is written by the switcher/onboarding/invite ACTIONS.
 */
export default async function MePage() {
  const contexts = await getUserContexts();
  if (!contexts) redirect("/login");

  const active = resolveActiveContext(contexts, await readActiveContextCookie());
  if (!active) redirect("/onboarding");

  redirect(contextHomePath(active));
}
