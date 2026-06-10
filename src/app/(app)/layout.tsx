import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getUserContexts } from "@/lib/auth/session";
import { readActiveContextCookie, resolveActiveContext } from "@/lib/auth/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const contexts = await getUserContexts();
  if (!contexts) redirect("/login");
  const active = resolveActiveContext(contexts, await readActiveContextCookie());
  return (
    <AppShell contexts={contexts} active={active}>
      {children}
    </AppShell>
  );
}
