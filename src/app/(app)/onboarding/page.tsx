import { requireContexts } from "@/lib/auth/guards";
import { ORG_KINDS } from "@/lib/org-kinds";
import { createOrganizationAction, createProviderAction } from "./actions";

export const metadata = { title: "Get started" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, contexts] = await Promise.all([searchParams, requireContexts()]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-semibold">
        {contexts.provider || contexts.orgs.length > 0 ? "Add another role" : "How will you use this?"}
      </h1>
      <p className="mt-2 text-ink-soft">
        One account can hold both — many med-spa owners are also working injectors.
      </p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <section className="oc-card p-6">
          <h2 className="text-xl font-semibold">I&apos;m a provider</h2>
          <p className="mt-2 min-h-12 text-sm text-ink-soft">
            Injector, aesthetician, laser tech, massage therapist, makeup artist, or wellness
            provider looking for shifts and opportunities.
          </p>
          {contexts.provider ? (
            <p className="oc-notice mt-4">
              You already have a provider profile ({contexts.provider.displayName}).
            </p>
          ) : (
            <form action={createProviderAction} className="mt-4 space-y-3">
              <div>
                <label htmlFor="displayName" className="oc-label">
                  Name businesses will see
                </label>
                <input
                  id="displayName"
                  name="displayName"
                  required
                  minLength={2}
                  placeholder="e.g. Maya Chen, RN"
                  className="oc-input"
                />
              </div>
              <button type="submit" className="oc-btn w-full">
                Create provider profile
              </button>
            </form>
          )}
        </section>

        <section className="oc-card p-6">
          <h2 className="text-xl font-semibold">I&apos;m a business</h2>
          <p className="mt-2 min-h-12 text-sm text-ink-soft">
            Spa, med spa, clinic, salon, studio, or other organization that needs coverage,
            contract help, or staff.
          </p>
          <form action={createOrganizationAction} className="mt-4 space-y-3">
            <div>
              <label htmlFor="name" className="oc-label">
                Business name
              </label>
              <input
                id="name"
                name="name"
                required
                minLength={2}
                placeholder="e.g. Peachtree Aesthetics"
                className="oc-input"
              />
            </div>
            <div>
              <label htmlFor="kind" className="oc-label">
                Business type
              </label>
              <select id="kind" name="kind" defaultValue="med_spa" className="oc-input">
                {ORG_KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="oc-btn w-full">
              Create business
            </button>
          </form>
        </section>
      </div>

      <p className="mt-8 text-sm text-ink-soft">
        You can refine everything later — services, credentials, locations, and team members come
        next.
      </p>
    </div>
  );
}
