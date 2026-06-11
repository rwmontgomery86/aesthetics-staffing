import Image from "next/image";
import Link from "next/link";
import { brand } from "@/config/brand";
import { NotificationsBell } from "@/components/NotificationsBell";
import type { UserContexts } from "@/lib/auth/session";
import { type ActiveContext, contextHomePath, serializeContext } from "@/lib/auth/context";
import { signOutAction } from "@/app/(auth)/actions";
import { switchContextAction } from "@/app/(app)/actions";

function contextLabel(ctx: ActiveContext, contexts: UserContexts): string {
  switch (ctx.kind) {
    case "provider":
      return `Provider — ${contexts.provider?.displayName ?? ""}`;
    case "admin":
      return "Platform admin";
    case "org":
      return contexts.orgs.find((o) => o.id === ctx.orgId)?.name ?? "Business";
  }
}

/** Top bar: wordmark, hat switcher (plain <details> menu — no client JS),
 *  sign out. Server component. */
export function AppShell({
  contexts,
  active,
  children,
}: {
  contexts: UserContexts;
  active: ActiveContext | null;
  children: React.ReactNode;
}) {
  const options: ActiveContext[] = [
    ...(contexts.provider ? [{ kind: "provider" } as const] : []),
    ...contexts.orgs.map((o) => ({ kind: "org", orgId: o.id }) as const),
    ...(contexts.isAdmin ? [{ kind: "admin" } as const] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href={active ? contextHomePath(active) : "/me"} className="shrink-0">
            <Image
              src={brand.logo.wordmark}
              alt={brand.name}
              width={124}
              height={30}
              priority
              className="h-[30px] w-auto"
            />
          </Link>

          <div className="flex items-center gap-3">
            <NotificationsBell />
            {active && options.length > 1 ? (
              <details className="group relative">
                <summary className="oc-btn-secondary cursor-pointer list-none select-none">
                  {contextLabel(active, contexts)}
                  <span aria-hidden className="text-ink-soft">
                    ▾
                  </span>
                </summary>
                <div className="absolute right-0 z-20 mt-2 w-64 rounded-card border border-line bg-surface p-2 shadow-card">
                  <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-ink-soft">
                    Act as
                  </p>
                  {options.map((opt) => (
                    <form key={serializeContext(opt)} action={switchContextAction}>
                      <input type="hidden" name="context" value={serializeContext(opt)} />
                      <button
                        type="submit"
                        className={`w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-ink/5 ${
                          serializeContext(opt) === (active ? serializeContext(active) : "")
                            ? "font-semibold text-lilac"
                            : "text-ink"
                        }`}
                      >
                        {contextLabel(opt, contexts)}
                      </button>
                    </form>
                  ))}
                  <div className="my-1 border-t border-line" />
                  <Link
                    href="/onboarding"
                    className="block rounded-lg px-2 py-2 text-sm text-ink-soft hover:bg-ink/5"
                  >
                    + Add provider or business
                  </Link>
                </div>
              </details>
            ) : active ? (
              <span className="text-sm text-ink-soft">{contextLabel(active, contexts)}</span>
            ) : null}

            <form action={signOutAction}>
              <button type="submit" className="oc-btn-ghost">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
