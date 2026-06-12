import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getUserContexts } from "@/lib/auth/session";
import { readActiveContextCookie, resolveActiveContext } from "@/lib/auth/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const contexts = await getUserContexts();
  if (!contexts) redirect("/login");
  // App-level suspension gate (RLS is untouched — this is the UX boundary;
  // /suspended lives outside this layout so the redirect can't loop).
  if (contexts.suspendedAt) redirect("/suspended");
  const active = resolveActiveContext(contexts, await readActiveContextCookie());
  return (
    <AppShell contexts={contexts} active={active}>
      {children}
    </AppShell>
  );
}
