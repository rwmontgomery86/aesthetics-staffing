import { redirect } from "next/navigation";
import { getUserContexts } from "@/lib/auth/session";
import {
  contextHomePath,
  readActiveContextCookie,
  resolveActiveContext,
  writeActiveContextCookie,
} from "@/lib/auth/context";

/** Post-login traffic cop: route to the active hat's home, or onboarding. */
export default async function MePage() {
  const contexts = await getUserContexts();
  if (!contexts) redirect("/login");

  const active = resolveActiveContext(contexts, await readActiveContextCookie());
  if (!active) redirect("/onboarding");

  await writeActiveContextCookie(active);
  redirect(contextHomePath(active));
}
