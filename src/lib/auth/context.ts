import "server-only";
import { cookies } from "next/headers";
import type { UserContexts } from "./session";

/**
 * The active "hat" (provider / a specific org / admin) lives in a cookie —
 * deliberately NOT in the JWT, so adding a user to an org takes effect on the
 * next request without re-login.
 */

const COOKIE = "oc-active-context";

export type ActiveContext =
  | { kind: "provider" }
  | { kind: "org"; orgId: string }
  | { kind: "admin" };

export function serializeContext(ctx: ActiveContext): string {
  return ctx.kind === "org" ? `org:${ctx.orgId}` : ctx.kind;
}

export function parseContext(raw: string | undefined): ActiveContext | null {
  if (!raw) return null;
  if (raw === "provider") return { kind: "provider" };
  if (raw === "admin") return { kind: "admin" };
  if (raw.startsWith("org:")) return { kind: "org", orgId: raw.slice(4) };
  return null;
}

export async function readActiveContextCookie(): Promise<ActiveContext | null> {
  const store = await cookies();
  return parseContext(store.get(COOKIE)?.value);
}

export async function writeActiveContextCookie(ctx: ActiveContext): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, serializeContext(ctx), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * Pick the hat to act under: the cookie if it's still valid for this user,
 * otherwise provider → first org → admin, else null (needs onboarding).
 */
export function resolveActiveContext(
  contexts: UserContexts,
  fromCookie: ActiveContext | null,
): ActiveContext | null {
  if (fromCookie) {
    if (fromCookie.kind === "provider" && contexts.provider) return fromCookie;
    if (fromCookie.kind === "admin" && contexts.isAdmin) return fromCookie;
    if (fromCookie.kind === "org" && contexts.orgs.some((o) => o.id === fromCookie.orgId)) {
      return fromCookie;
    }
  }
  if (contexts.provider) return { kind: "provider" };
  if (contexts.orgs.length > 0) return { kind: "org", orgId: contexts.orgs[0].id };
  if (contexts.isAdmin) return { kind: "admin" };
  return null;
}

export function contextHomePath(ctx: ActiveContext): string {
  switch (ctx.kind) {
    case "provider":
      return "/p";
    case "org":
      return "/b";
    case "admin":
      return "/admin";
  }
}
