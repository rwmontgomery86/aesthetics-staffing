import Link from "next/link";
import { DateTime } from "luxon";
import { and, desc, eq, sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { opportunities, organizations, threadParticipants, threads } from "@/db/schema";
import { requireProviderRow } from "@/lib/provider";

export const metadata = { title: "Messages" };

export default async function ProviderMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, { user, provider }] = await Promise.all([
    searchParams,
    requireProviderRow(),
  ]);

  const rows = await dbAs(user, (tx) =>
    tx
      .select({
        id: threads.id,
        lastMessageAt: threads.lastMessageAt,
        createdAt: threads.createdAt,
        title: opportunities.title,
        orgName: organizations.name,
        unread: threadParticipants.unreadCount,
        lastBody: sql<string | null>`(
          select m.body from messages m
          where m.thread_id = ${threads.id}
          order by m.created_at desc limit 1
        )`,
      })
      .from(threads)
      .leftJoin(opportunities, eq(opportunities.id, threads.opportunityId))
      .leftJoin(organizations, eq(organizations.id, threads.organizationId))
      .leftJoin(
        threadParticipants,
        and(eq(threadParticipants.threadId, threads.id), eq(threadParticipants.userId, user.id)),
      )
      .where(eq(threads.providerProfileId, provider.id))
      .orderBy(desc(sql`coalesce(${threads.lastMessageAt}, ${threads.createdAt})`)),
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Messages</h1>
      <p className="mt-2 text-ink-soft">
        Every conversation is tied to an opportunity you applied to. Keep things on-platform —
        contact details unlock once a booking is confirmed.
      </p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      {rows.length === 0 ? (
        <div className="oc-card mt-8 p-6 text-center text-sm text-ink-soft">
          <p>No conversations yet.</p>
          <p className="mt-1">
            Apply to an opportunity and the conversation with the business starts here.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/p/messages/${row.id}`}
              className="oc-card block p-4 hover:border-lilac"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">{row.orgName ?? "Business"}</p>
                <p className="shrink-0 text-xs text-ink-soft">
                  {DateTime.fromJSDate(row.lastMessageAt ?? row.createdAt).toFormat("MMM d")}
                </p>
              </div>
              <p className="text-sm text-ink-soft">{row.title ?? "Opportunity"}</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm text-ink-soft/80">
                  {row.lastBody ?? "No messages yet"}
                </p>
                {(row.unread ?? 0) > 0 ? (
                  <span className="shrink-0 rounded-full bg-lilac px-2 py-0.5 text-xs font-semibold text-white">
                    {row.unread}
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
