import Link from "next/link";
import { sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guards";
import { ts, type Ts } from "@/app/(app)/admin/format";

export const metadata = { title: "Bookings — admin" };

const STATUSES = [
  "all",
  "confirmed",
  "completed",
  "canceled_by_provider",
  "canceled_by_business",
  "disputed",
] as const;

type Row = {
  id: string;
  status: string;
  created_at: Ts;
  title: string;
  org_name: string;
  provider_name: string;
  date_count: number;
  disputed_records: number;
}

/** Read-only explorer — booking interventions stay with the parties (cancel
 *  flows on their own pages); admins watch, audit, and mediate via reports. */
export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ status: rawStatus }, contexts] = await Promise.all([searchParams, requireAdmin()]);
  const status = STATUSES.includes(rawStatus as (typeof STATUSES)[number])
    ? (rawStatus as string)
    : "all";

  const rows = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) =>
    (
      await tx.execute<Row>(sql`
        select b.id, b.status, b.created_at, op.title, o.name as org_name,
               pp.display_name as provider_name,
               (select count(*)::int from booking_occurrences bo where bo.booking_id = b.id) as date_count,
               (select count(*)::int from completion_records cr
                 where cr.booking_id = b.id and cr.status = 'disputed') as disputed_records
        from bookings b
        join opportunities op on op.id = b.opportunity_id
        join organizations o on o.id = b.organization_id
        join provider_profiles pp on pp.id = b.provider_profile_id
        where ${status} = 'all' or b.status::text = ${status}
        order by b.created_at desc
        limit 100
      `)
    ).rows,
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold">Bookings</h1>
      <p className="mt-2 text-ink-soft">
        Read-only — cancellations and completions belong to the two parties. Disputes surface
        under Reports.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/bookings?status=${s}`}
            className={`rounded-full px-3 py-1 text-sm ${
              status === s ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
            }`}
          >
            {s.replaceAll("_", " ")}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="oc-card mt-6 p-6 text-center text-sm text-ink-soft">No bookings here.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="oc-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{row.title}</span>
                <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink-soft">
                  {row.status.replaceAll("_", " ")}
                </span>
                {row.disputed_records > 0 ? (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                    disputed completion
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-ink-soft">
                {row.provider_name} ↔ {row.org_name} · {row.date_count} date
                {row.date_count === 1 ? "" : "s"} · booked{" "}
                {ts(row.created_at).toFormat("MMM d, yyyy")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
