import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js 16 proxy (the artist formerly known as middleware).
 * Two jobs: keep the Supabase session cookie fresh on every navigation, and
 * keep signed-out users off authenticated routes. This is routing UX only —
 * the real security boundary is RLS (see src/db/client.ts).
 */

const PROTECTED = /^\/(me|onboarding|p|b|admin)(\/|$)/;
const AUTH_PAGES = /^\/(login|signup)(\/|$)/;

export default async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Unconfigured (fresh clone, CI build): pass through so the public site works.
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refreshes the token if expired — must be called before any redirect logic.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && PROTECTED.test(path)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", path);
    return NextResponse.redirect(redirect);
  }

  if (user && AUTH_PAGES.test(path)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/me";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2)).*)",
  ],
};
