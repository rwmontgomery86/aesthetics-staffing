import { sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guards";
import { saveOrgNotesAction, setOrgVerifiedAction } from "@/app/(app)/admin/actions";
import { ts, type Ts } from "@/app/(app)/admin/format";

export const metadata = { title: "Businesses — admin" };

type Row = {
  id: string;
  name: string;
  kind: string;
  verified_at: Ts | null;
  created_at: Ts;
  member_count: number;
  post_count: number;
  booking_count: number;
  notes: string | null;
}

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; notice?: string; error?: string }>;
}) {
  const [{ q = "", notice, error }, contexts] = await Promise.all([
    searchParams,
    requireAdmin(),
  ]);

  const rows = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) =>
    (
      await tx.execute<Row>(sql`
        select o.id, o.name, o.kind, o.verified_at, o.created_at,
               (select count(*)::int from organization_members m where m.organization_id = o.id) as member_count,
               (select count(*)::int from opportunities op where op.organization_id = o.id) as post_count,
               (select count(*)::int from bookings b where b.organization_id = o.id) as booking_count,
               n.notes
        from organizations o
        left join organization_admin_notes n on n.organization_id = o.id
        where ${q} = '' or o.name ilike '%' || ${q} || '%'
        order by o.created_at desc
        limit 100
      `)
    ).rows,
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold">Businesses</h1>
      <p className="mt-2 text-ink-soft">
        Notes here are admin-only — businesses never see them. The verified badge shows on their
        public profile and posts.
      </p>
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      <form className="mt-6 flex gap-2" action="/admin/organizations" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search businesses…"
          className="oc-input w-56"
        />
        <button type="submit" className="oc-btn-secondary">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="oc-card mt-6 p-6 text-center text-sm text-ink-soft">
          No matching businesses.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="oc-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{row.name}</span>
                <span className="text-xs text-ink-soft">{row.kind.replaceAll("_", " ")}</span>
                {row.verified_at ? (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    verified
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-ink-soft">
                Since {ts(row.created_at).toFormat("MMM yyyy")} · {row.member_count}{" "}
                member{row.member_count === 1 ? "" : "s"} · {row.post_count} post
                {row.post_count === 1 ? "" : "s"} · {row.booking_count} booking
                {row.booking_count === 1 ? "" : "s"}
              </p>

              <div className="mt-3 flex flex-wrap items-start gap-4">
                <form action={setOrgVerifiedAction}>
                  <input type="hidden" name="organizationId" value={row.id} />
                  <input type="hidden" name="verified" value={row.verified_at ? "false" : "true"} />
                  <button type="submit" className="text-sm underline hover:text-lilac">
                    {row.verified_at ? "Remove verified badge" : "Mark verified"}
                  </button>
                </form>
                <details className="min-w-0 flex-1">
                  <summary className="cursor-pointer text-sm text-ink-soft underline hover:text-ink">
                    Admin notes{row.notes ? " (has notes)" : ""}
                  </summary>
                  <form action={saveOrgNotesAction} className="mt-2 flex items-end gap-2">
                    <input type="hidden" name="organizationId" value={row.id} />
                    <textarea
                      name="notes"
                      rows={3}
                      defaultValue={row.notes ?? ""}
                      className="oc-input flex-1"
                      placeholder="Visible to platform admins only."
                    />
                    <button type="submit" className="oc-btn-secondary">
                      Save
                    </button>
                  </form>
                </details>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
