import Link from "next/link";
import { sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guards";
import { suspendUserAction, unsuspendUserAction } from "@/app/(app)/admin/actions";
import { ts, type Ts } from "@/app/(app)/admin/format";

export const metadata = { title: "Users — admin" };

type Row = {
  id: string;
  full_name: string;
  email: string | null;
  is_platform_admin: boolean;
  suspended_at: Ts | null;
  suspended_reason: string | null;
  created_at: Ts;
  provider_name: string | null;
  org_names: string[] | null;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; notice?: string; error?: string }>;
}) {
  const [{ q = "", filter, notice, error }, contexts] = await Promise.all([
    searchParams,
    requireAdmin(),
  ]);
  const suspendedOnly = filter === "suspended";

  const rows = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) =>
    (
      await tx.execute<Row>(sql`
        select p.id, p.full_name, public.admin_user_email(p.id) as email,
               p.is_platform_admin, p.suspended_at, p.suspended_reason, p.created_at,
               pp.display_name as provider_name,
               (select array_agg(o.name) from organization_members m
                  join organizations o on o.id = m.organization_id
                  where m.user_id = p.id) as org_names
        from profiles p
        left join provider_profiles pp on pp.user_id = p.id
        where (${q} = '' or p.full_name ilike '%' || ${q} || '%'
               or pp.display_name ilike '%' || ${q} || '%')
          and (${suspendedOnly} = false or p.suspended_at is not null)
        order by p.created_at desc
        limit 100
      `)
    ).rows,
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold">Users</h1>
      <p className="mt-2 text-ink-soft">
        Suspending blocks the whole account (all hats) at sign-in; it does not cancel existing
        bookings — handle those separately if needed.
      </p>
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form className="flex gap-2" action="/admin/users" method="get">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search names…"
            className="oc-input w-56"
          />
          <button type="submit" className="oc-btn-secondary">
            Search
          </button>
        </form>
        <Link
          href={suspendedOnly ? "/admin/users" : "/admin/users?filter=suspended"}
          className={`rounded-full px-3 py-1 text-sm ${
            suspendedOnly ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
          }`}
        >
          Suspended only
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="oc-card mt-6 p-6 text-center text-sm text-ink-soft">No matching users.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="oc-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{row.full_name || "(no name)"}</span>
                {row.email ? <span className="text-sm text-ink-soft">{row.email}</span> : null}
                {row.is_platform_admin ? (
                  <span className="rounded-full bg-lilac/10 px-2 py-0.5 text-xs font-medium text-lilac">
                    admin
                  </span>
                ) : null}
                {row.suspended_at ? (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                    suspended
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-ink-soft">
                Joined {ts(row.created_at).toFormat("MMM d, yyyy")}
                {row.provider_name ? <> · Provider: {row.provider_name}</> : null}
                {row.org_names?.length ? <> · Business: {row.org_names.join(", ")}</> : null}
              </p>
              {row.suspended_at ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-ink-soft">
                    Suspended {ts(row.suspended_at).toFormat("MMM d")} —{" "}
                    {row.suspended_reason ?? "no reason recorded"}
                  </span>
                  <form action={unsuspendUserAction}>
                    <input type="hidden" name="userId" value={row.id} />
                    <button type="submit" className="underline hover:text-lilac">
                      Reinstate
                    </button>
                  </form>
                </div>
              ) : row.id !== contexts.user.id ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-ink-soft underline hover:text-danger">
                    Suspend…
                  </summary>
                  <form action={suspendUserAction} className="mt-2 flex items-end gap-2">
                    <input type="hidden" name="userId" value={row.id} />
                    <div className="flex-1">
                      <label className="oc-label">Reason (kept in the audit log)</label>
                      <input name="reason" required className="oc-input" />
                    </div>
                    <button type="submit" className="oc-btn-secondary text-danger">
                      Suspend
                    </button>
                  </form>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
