import Link from "next/link";
import { sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guards";
import { ts, type Ts } from "@/app/(app)/admin/format";

export const metadata = { title: "Reports — admin" };

type FlaggedThread = {
  thread_id: string;
  flagged_count: number;
  last_flagged_at: Ts;
  provider_name: string;
  org_name: string;
  title: string;
}
type DisputedCompletion = {
  id: string;
  booking_id: string;
  amount_cents: number;
  created_at: Ts;
  title: string;
  provider_name: string;
  org_name: string;
}
type NoShow = {
  booking_id: string;
  occurrence_id: string;
  status: string;
  title: string;
  provider_name: string;
  org_name: string;
  starts_at: Ts;
}

/** USER_FLOWS §13: flagged messages, disputed completions, no-show reports —
 *  the mediation worklist. Resolution happens with the parties (and Phase 8's
 *  audited thread view); this page is the queue. */
export default async function AdminReportsPage() {
  const contexts = await requireAdmin();

  const data = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const flagged = (
      await tx.execute<FlaggedThread>(sql`
        select t.id as thread_id, count(*)::int as flagged_count,
               max(m.created_at) as last_flagged_at,
               pp.display_name as provider_name, o.name as org_name, op.title
        from messages m
        join threads t on t.id = m.thread_id
        join provider_profiles pp on pp.id = t.provider_profile_id
        join organizations o on o.id = t.organization_id
        join opportunities op on op.id = t.opportunity_id
        where m.contact_flagged
        group by t.id, pp.display_name, o.name, op.title
        order by max(m.created_at) desc
        limit 50
      `)
    ).rows;
    const disputed = (
      await tx.execute<DisputedCompletion>(sql`
        select cr.id, cr.booking_id, cr.amount_cents, cr.created_at,
               op.title, pp.display_name as provider_name, o.name as org_name
        from completion_records cr
        join bookings b on b.id = cr.booking_id
        join opportunities op on op.id = b.opportunity_id
        join provider_profiles pp on pp.id = b.provider_profile_id
        join organizations o on o.id = b.organization_id
        where cr.status = 'disputed'
        order by cr.created_at desc
        limit 50
      `)
    ).rows;
    const noShows = (
      await tx.execute<NoShow>(sql`
        select bo.booking_id, bo.occurrence_id, bo.status,
               op.title, pp.display_name as provider_name, o.name as org_name,
               oo.starts_at
        from booking_occurrences bo
        join bookings b on b.id = bo.booking_id
        join opportunities op on op.id = b.opportunity_id
        join provider_profiles pp on pp.id = b.provider_profile_id
        join organizations o on o.id = b.organization_id
        join opportunity_occurrences oo on oo.id = bo.occurrence_id
        where bo.no_show_reported_by_user_id is not null
        order by oo.starts_at desc
        limit 50
      `)
    ).rows;
    return { flagged, disputed, noShows };
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold">Reports &amp; disputes</h1>
      <p className="mt-2 text-ink-soft">
        The mediation queue. Open the thread to see context — that view is audited.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Flagged messages</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Contact details shared before the booking confirmed (sent, warned, flagged — never
          blocked).
        </p>
        {data.flagged.length === 0 ? (
          <p className="oc-card mt-3 p-4 text-sm text-ink-soft">Nothing flagged.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {data.flagged.map((row) => (
              <Link
                key={row.thread_id}
                href={`/admin/threads/${row.thread_id}`}
                className="oc-card block p-3 text-sm hover:border-lilac"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {row.provider_name} ↔ {row.org_name}
                  </span>
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                    {row.flagged_count} flagged
                  </span>
                  <span className="ml-auto text-xs text-ink-soft">
                    {ts(row.last_flagged_at).toFormat("MMM d")}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-soft">{row.title}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Disputed completions</h2>
        <p className="mt-1 text-xs text-ink-soft">
          The provider disagrees with the recorded hours/amount.
        </p>
        {data.disputed.length === 0 ? (
          <p className="oc-card mt-3 p-4 text-sm text-ink-soft">No open disputes.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {data.disputed.map((row) => (
              <div key={row.id} className="oc-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {row.provider_name} ↔ {row.org_name}
                  </span>
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                    ${(row.amount_cents / 100).toFixed(2)} disputed
                  </span>
                  <span className="ml-auto text-xs text-ink-soft">
                    {ts(row.created_at).toFormat("MMM d")}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-soft">{row.title}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">No-show reports</h2>
        {data.noShows.length === 0 ? (
          <p className="oc-card mt-3 p-4 text-sm text-ink-soft">No reports.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {data.noShows.map((row) => (
              <div key={`${row.booking_id}:${row.occurrence_id}`} className="oc-card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {row.provider_name} ↔ {row.org_name}
                  </span>
                  <span className="rounded-full bg-blush/30 px-2 py-0.5 text-xs font-medium text-blush-deep">
                    {row.status.replaceAll("_", " ")}
                  </span>
                  <span className="ml-auto text-xs text-ink-soft">
                    shift {ts(row.starts_at).toFormat("MMM d")}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-soft">{row.title}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
