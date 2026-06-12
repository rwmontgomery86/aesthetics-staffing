import Link from "next/link";
import { DateTime } from "luxon";
import { and, desc, eq, sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { opportunities, providerProfiles, threadParticipants, threads } from "@/db/schema";
import { requireActiveOrg } from "@/lib/org";

export const metadata = { title: "Messages" };

export default async function BusinessMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, { contexts, org }] = await Promise.all([searchParams, requireActiveOrg()]);
  const user = contexts.user;

  const rows = await dbAs({ id: user.id, email: user.email }, (tx) =>
    tx
      .select({
        id: threads.id,
        lastMessageAt: threads.lastMessageAt,
        createdAt: threads.createdAt,
        title: opportunities.title,
        providerName: providerProfiles.displayName,
        unread: threadParticipants.unreadCount,
        lastBody: sql<string | null>`(
          select m.body from messages m
          where m.thread_id = ${threads.id}
          order by m.created_at desc limit 1
        )`,
      })
      .from(threads)
      .leftJoin(opportunities, eq(opportunities.id, threads.opportunityId))
      .leftJoin(providerProfiles, eq(providerProfiles.id, threads.providerProfileId))
      .leftJoin(
        threadParticipants,
        and(eq(threadParticipants.threadId, threads.id), eq(threadParticipants.userId, user.id)),
      )
      .where(eq(threads.organizationId, org.id))
      .orderBy(desc(sql`coalesce(${threads.lastMessageAt}, ${threads.createdAt})`)),
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Messages</h1>
      <p className="mt-2 text-ink-soft">
        Conversations with applicants and booked providers, one per opportunity. The last message
        snippet stays private to people in the conversation — open a thread to join it.
      </p>
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      {rows.length === 0 ? (
        <div className="oc-card mt-8 p-6 text-center text-sm text-ink-soft">
          <p>No conversations yet.</p>
          <p className="mt-1">
            They start when a provider applies — or from the Message button on your{" "}
            <Link href="/b/opportunities" className="underline hover:text-lilac">
              applicant lists
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/b/messages/${row.id}`}
              className="oc-card block p-4 hover:border-lilac"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">{row.providerName ?? "Provider"}</p>
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
