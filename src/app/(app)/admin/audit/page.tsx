import Link from "next/link";
import { sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guards";
import { ts, type Ts } from "@/app/(app)/admin/format";

export const metadata = { title: "Audit log — admin" };

type Row = {
  id: number;
  actor_user_id: string | null;
  actor_name: string | null;
  acting_as: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown>;
  created_at: Ts;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q = "" }, contexts] = await Promise.all([searchParams, requireAdmin()]);

  const rows = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) =>
    (
      await tx.execute<Row>(sql`
        select a.id, a.actor_user_id, p.full_name as actor_name, a.acting_as,
               a.action, a.entity_type, a.entity_id, a.changes, a.created_at
        from audit_logs a
        left join profiles p on p.id = a.actor_user_id
        where ${q} = '' or a.action ilike '%' || ${q} || '%'
           or a.entity_type ilike '%' || ${q} || '%'
        order by a.created_at desc
        limit 150
      `)
    ).rows,
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold">Audit log</h1>
      <p className="mt-2 text-ink-soft">
        Append-only — every sensitive action by users, admins, and the system, newest first.
      </p>

      <form className="mt-6 flex gap-2" action="/admin/audit" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Filter by action — e.g. credential, suspended, thread…"
          className="oc-input w-80"
        />
        <button type="submit" className="oc-btn-secondary">
          Filter
        </button>
        {q ? (
          <Link href="/admin/audit" className="oc-btn-ghost">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="oc-card mt-6 p-6 text-center text-sm text-ink-soft">No entries match.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {rows.map((row) => {
            const changes = JSON.stringify(row.changes);
            return (
              <div key={row.id} className="oc-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.action}</span>
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink-soft">
                    {row.acting_as}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {row.actor_name ?? row.actor_user_id ?? "system"}
                  </span>
                  <span className="ml-auto text-xs text-ink-soft">
                    {ts(row.created_at).toFormat("MMM d · h:mm:ss a")}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {row.entity_type}
                  {row.entity_id ? ` ${row.entity_id}` : ""}
                  {changes !== "{}" ? ` — ${changes}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
