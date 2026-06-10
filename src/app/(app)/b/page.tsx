import { requireOrgMember } from "@/lib/auth/guards";
import { readActiveContextCookie } from "@/lib/auth/context";

export const metadata = { title: "Business dashboard" };

export default async function BusinessDashboard() {
  const cookieCtx = await readActiveContextCookie();
  const activeOrgId = cookieCtx?.kind === "org" ? cookieCtx.orgId : undefined;
  const { org } = await requireOrgMember(activeOrgId);

  return (
    <div>
      <h1 className="text-3xl font-semibold">{org.name}</h1>
      <p className="mt-2 text-ink-soft">
        Your business dashboard — you&apos;re {org.role === "owner" ? "the owner" : `an ${org.role}`}.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        <section className="oc-card p-6">
          <h2 className="font-semibold">Locations</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Add the places providers will work — each gets its own map pin.
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-lilac">
            Coming in Phase 4
          </p>
        </section>
        <section className="oc-card p-6">
          <h2 className="font-semibold">Team</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Invite teammates who can post opportunities or manage the account.
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-lilac">
            Coming in Phase 4
          </p>
        </section>
        <section className="oc-card p-6">
          <h2 className="font-semibold">Post an opportunity</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Shifts, roles, and events — matching providers get alerted instantly.
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-lilac">
            Coming in Phase 5
          </p>
        </section>
      </div>
    </div>
  );
}
