import Link from "next/link";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-ink-soft">We&apos;ll email you a secure link.</p>

      <form action={forgotPasswordAction} className="oc-card mt-8 space-y-4 p-6">
        <div>
          <label htmlFor="email" className="oc-label">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required className="oc-input" />
        </div>
        {error ? <p className="oc-error">{error}</p> : null}
        {notice ? <p className="oc-notice">{notice}</p> : null}
        <button type="submit" className="oc-btn w-full">
          Send reset link
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-soft">
        <Link href="/login" className="underline hover:text-lilac">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
