import { requireProvider } from "@/lib/auth/guards";

export const metadata = { title: "Provider dashboard" };

export default async function ProviderDashboard() {
  const { provider } = await requireProvider();

  return (
    <div>
      <h1 className="text-3xl font-semibold">Welcome, {provider.displayName}</h1>
      <p className="mt-2 text-ink-soft">Your provider dashboard.</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        <section className="oc-card p-6">
          <h2 className="font-semibold">Watch zones</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Draw the areas where you want opportunity alerts.
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-brass">
            Coming in Phase 3
          </p>
        </section>
        <section className="oc-card p-6">
          <h2 className="font-semibold">Credentials</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Licenses, certifications, and documents — self-attest now, upload anytime.
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-brass">
            Coming in Phase 3
          </p>
        </section>
        <section className="oc-card p-6">
          <h2 className="font-semibold">Opportunities</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Matching shifts and roles appear here the moment they post.
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-brass">
            Coming in Phase 6
          </p>
        </section>
      </div>
    </div>
  );
}
