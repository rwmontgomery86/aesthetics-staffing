import Link from "next/link";
import { sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guards";
import { removePostAction } from "@/app/(app)/admin/actions";
import { ts, type Ts } from "@/app/(app)/admin/format";

export const metadata = { title: "Posts — admin" };

const STATUSES = ["posted", "draft", "filled", "expired", "canceled", "archived", "all"] as const;

type Row = {
  id: string;
  title: string;
  type: string;
  status: string;
  urgent: boolean;
  posted_at: Ts | null;
  created_at: Ts;
  org_name: string;
  application_count: number;
}

export default async function AdminOpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; notice?: string; error?: string }>;
}) {
  const [{ status: rawStatus, notice, error }, contexts] = await Promise.all([
    searchParams,
    requireAdmin(),
  ]);
  const status = STATUSES.includes(rawStatus as (typeof STATUSES)[number])
    ? (rawStatus as string)
    : "posted";

  const rows = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) =>
    (
      await tx.execute<Row>(sql`
        select op.id, op.title, op.type, op.status, op.urgent, op.posted_at, op.created_at,
               o.name as org_name,
               (select count(*)::int from applications a where a.opportunity_id = op.id) as application_count
        from opportunities op
        join organizations o on o.id = op.organization_id
        where ${status} = 'all' or op.status::text = ${status}
        order by coalesce(op.posted_at, op.created_at) desc
        limit 100
      `)
    ).rows,
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold">Posts</h1>
      <p className="mt-2 text-ink-soft">
        Removing a post archives it — it leaves search and alerts immediately, the business is
        notified, and existing bookings are untouched.
      </p>
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/opportunities?status=${s}`}
            className={`rounded-full px-3 py-1 text-sm ${
              status === s ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="oc-card mt-6 p-6 text-center text-sm text-ink-soft">No posts here.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="oc-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/o/${row.id}`} className="font-semibold hover:text-lilac">
                  {row.title}
                </Link>
                {row.urgent ? (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                    urgent
                  </span>
                ) : null}
                <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink-soft">
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-soft">
                {row.org_name} · {row.type.replaceAll("_", " ")} ·{" "}
                {row.application_count} application{row.application_count === 1 ? "" : "s"} ·{" "}
                {ts(row.posted_at ?? row.created_at).toFormat("MMM d, yyyy")}
              </p>
              {row.status === "posted" ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-ink-soft underline hover:text-danger">
                    Remove post…
                  </summary>
                  <form action={removePostAction} className="mt-2 flex items-end gap-2">
                    <input type="hidden" name="opportunityId" value={row.id} />
                    <div className="flex-1">
                      <label className="oc-label">Reason (sent to the business, optional)</label>
                      <input name="reason" className="oc-input" />
                    </div>
                    <button type="submit" className="oc-btn-secondary text-danger">
                      Remove
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
