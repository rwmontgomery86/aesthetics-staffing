import Link from "next/link";
import { DateTime } from "luxon";
import { desc, eq, sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { opportunities, organizations, providerProfiles, threads } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guards";

export const metadata = { title: "Threads — admin" };

/**
 * Support/review entry point (Phase 8 scope; the full admin dashboard is
 * Phase 9). Flagged = pre-reveal contact-pattern messages. Opening a thread
 * writes an audit row — that page is the only admin read path for bodies.
 */
export default async function AdminThreadsPage() {
  const contexts = await requireAdmin();
  const user = contexts.user;

  const rows = await dbAs({ id: user.id, email: user.email }, (tx) =>
    tx
      .select({
        id: threads.id,
        lastMessageAt: threads.lastMessageAt,
        createdAt: threads.createdAt,
        lockedAt: threads.lockedAt,
        title: opportunities.title,
        orgName: organizations.name,
        providerName: providerProfiles.displayName,
        flagged: sql<number>`(
          select count(*)::int from messages m
          where m.thread_id = ${threads.id} and m.contact_flagged
        )`,
      })
      .from(threads)
      .leftJoin(opportunities, eq(opportunities.id, threads.opportunityId))
      .leftJoin(organizations, eq(organizations.id, threads.organizationId))
      .leftJoin(providerProfiles, eq(providerProfiles.id, threads.providerProfileId))
      .orderBy(desc(sql`coalesce(${threads.lastMessageAt}, ${threads.createdAt})`))
      .limit(100),
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Message threads</h1>
      <p className="mt-2 text-ink-soft">
        Most recent first. Opening a thread is logged to the audit trail.
      </p>

      {rows.length === 0 ? (
        <p className="oc-card mt-8 p-6 text-center text-sm text-ink-soft">No threads yet.</p>
      ) : (
        <div className="mt-8 space-y-3">
          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/admin/threads/${row.id}`}
              className="oc-card block p-4 hover:border-lilac"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">
                  {row.providerName ?? "Provider"} ↔ {row.orgName ?? "Business"}
                </p>
                <p className="shrink-0 text-xs text-ink-soft">
                  {DateTime.fromJSDate(row.lastMessageAt ?? row.createdAt).toFormat("MMM d")}
                </p>
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
                <span className="min-w-0 flex-1 truncate">{row.title ?? "Opportunity"}</span>
                {row.flagged > 0 ? (
                  <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                    {row.flagged} flagged
                  </span>
                ) : null}
                {row.lockedAt ? (
                  <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium">
                    locked
                  </span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
