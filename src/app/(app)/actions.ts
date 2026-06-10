"use server";

import { redirect } from "next/navigation";
import { getUserContexts } from "@/lib/auth/session";
import {
  contextHomePath,
  parseContext,
  resolveActiveContext,
  writeActiveContextCookie,
} from "@/lib/auth/context";

/** Switch the active hat (provider / org / admin) — validated against what
 *  the user actually holds, then persisted in the context cookie. */
export async function switchContextAction(formData: FormData) {
  const contexts = await getUserContexts();
  if (!contexts) redirect("/login");

  const requested = parseContext(String(formData.get("context") ?? ""));
  const resolved = resolveActiveContext(contexts, requested);
  if (!resolved) redirect("/onboarding");

  await writeActiveContextCookie(resolved);
  redirect(contextHomePath(resolved));
}
