"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Auth server actions. Errors round-trip via the query string (?error=…) so
 * the pages need zero client-side JavaScript.
 */

const baseUrl = () => process.env.APP_BASE_URL ?? "http://localhost:4000";

function fail(page: string, message: string, extra?: Record<string, string>): never {
  const params = new URLSearchParams({ error: message, ...extra });
  redirect(`${page}?${params.toString()}`);
}

const emailSchema = z.string().trim().toLowerCase().email();
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export async function signUpAction(formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = emailSchema.safeParse(formData.get("email"));
  const password = passwordSchema.safeParse(formData.get("password"));
  // Carried through confirmation so flows like team invites land back where
  // they started (e.g. /invite/<token>).
  const rawNext = String(formData.get("next") ?? "");
  const next = rawNext.startsWith("/") ? rawNext : "/me";
  if (!fullName) fail("/signup", "Please enter your name.");
  if (!email.success) fail("/signup", "Please enter a valid email address.", { next });
  if (!password.success) fail("/signup", password.error.issues[0].message, { next });

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${baseUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) fail("/signup", error.message, { next });

  // Email confirmation off (dev) → session exists → straight in.
  if (data.session) redirect(next);
  redirect("/login?notice=" + encodeURIComponent("Check your email to confirm your account."));
}

export async function signInAction(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "") || "/me";
  if (!email.success) fail("/login", "Please enter a valid email address.");

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error) fail("/login", "Email or password is incorrect.", { next });
  redirect(next.startsWith("/") ? next : "/me");
}

export async function magicLinkAction(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) fail("/login", "Enter your email above first, then tap the magic link.");

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${baseUrl()}/auth/confirm` },
  });
  if (error) fail("/login", error.message);
  redirect("/login?notice=" + encodeURIComponent("Magic link sent — check your email."));
}

export async function forgotPasswordAction(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) fail("/forgot-password", "Please enter a valid email address.");

  const supabase = await getSupabaseServer();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${baseUrl()}/auth/confirm?next=/reset-password`,
  });
  // Deliberately the same message whether or not the account exists.
  redirect(
    "/forgot-password?notice=" +
      encodeURIComponent("If that email has an account, a reset link is on its way."),
  );
}

export async function resetPasswordAction(formData: FormData) {
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success) fail("/reset-password", password.error.issues[0].message);

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) fail("/reset-password", error.message);
  redirect("/me");
}

export async function signOutAction() {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
