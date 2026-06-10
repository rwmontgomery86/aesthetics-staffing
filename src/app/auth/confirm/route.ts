import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Lands email links (signup confirmation, magic link, password reset):
 * verifies the token hash, which sets the session cookies, then forwards on.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/me";
  const safeNext = next.startsWith("/") ? next : "/me";

  if (tokenHash && type) {
    const supabase = await getSupabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
  }

  return NextResponse.redirect(
    new URL(
      "/login?error=" + encodeURIComponent("That link is invalid or expired — request a new one."),
      request.url,
    ),
  );
}
