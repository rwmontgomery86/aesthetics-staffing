import Link from "next/link";
import { brand } from "@/config/brand";
import { signUpAction } from "../actions";

export const metadata = { title: "Create account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <p className="mt-1 text-ink-soft">
        One account works for both providers and businesses — you choose what to set up next.
      </p>

      <form action={signUpAction} className="oc-card mt-8 space-y-4 p-6">
        <div>
          <label htmlFor="fullName" className="oc-label">
            Full name
          </label>
          <input id="fullName" name="fullName" autoComplete="name" required className="oc-input" />
        </div>
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
            autoComplete="new-password"
            minLength={8}
            required
            className="oc-input"
          />
          <p className="mt-1 text-xs text-ink-soft">At least 8 characters.</p>
        </div>
        {error ? <p className="oc-error">{error}</p> : null}
        <button type="submit" className="oc-btn w-full">
          Create account
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        Already have an account?{" "}
        <Link href="/login" className="underline hover:text-lilac">
          Sign in
        </Link>
      </p>
      <p className="mt-4 text-center text-xs text-ink-soft/80">
        {brand.name} is in private preview. By creating an account you agree to placeholder terms
        pending legal review.
      </p>
    </main>
  );
}
