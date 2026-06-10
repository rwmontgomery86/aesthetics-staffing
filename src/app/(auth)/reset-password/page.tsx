import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>

      <form action={resetPasswordAction} className="oc-card mt-8 space-y-4 p-6">
        <div>
          <label htmlFor="password" className="oc-label">
            New password
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
          Save new password
        </button>
      </form>
    </main>
  );
}
