import Link from "next/link";
import { brand } from "@/config/brand";
import { magicLinkAction, signInAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; next?: string }>;
}) {
  const { error, notice, next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-semibold">{brand.name}</h1>
      <p className="mt-1 text-ink-soft">Sign in to your account</p>

      <form action={signInAction} className="oc-card mt-8 space-y-4 p-6">
        <input type="hidden" name="next" value={next ?? ""} />
        <div>
          <label htmlFor="email" className="oc-label">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className="oc-input" />
        </div>
        <div>
          <label htmlFor="password" className="oc-label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="oc-input"
          />
        </div>
        {error ? <p className="oc-error">{error}</p> : null}
        {notice ? <p className="oc-notice">{notice}</p> : null}
        <button type="submit" className="oc-btn w-full">
          Sign in
        </button>
        <button type="submit" formAction={magicLinkAction} formNoValidate className="oc-btn-ghost w-full">
          Email me a magic link instead
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        <Link href="/forgot-password" className="underline hover:text-brass-deep">
          Forgot password?
        </Link>
        <span className="mx-2">·</span>
        New here?{" "}
        <Link href="/signup" className="underline hover:text-brass-deep">
          Create an account
        </Link>
      </p>
    </main>
  );
}
