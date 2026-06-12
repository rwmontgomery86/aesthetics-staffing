import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  messages,
  opportunities,
  organizations,
  providerProfiles,
  threads,
} from "@/db/schema";
import { ThreadView } from "@/components/messaging/ThreadView";
import { ensureParticipant, markThreadRead } from "@/lib/messaging/threads";
import { requireActiveOrg } from "@/lib/org";
import { sendBusinessMessageAction } from "../actions";

export const metadata = { title: "Conversation" };

export default async function BusinessThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; warning?: string }>;
}) {
  const [{ id }, { error, warning }, { contexts, org }] = await Promise.all([
    params,
    searchParams,
    requireActiveOrg(),
  ]);
  const user = contexts.user;

  const data = await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const [thread] = await tx
      .select({
        id: threads.id,
        organizationId: threads.organizationId,
        opportunityId: threads.opportunityId,
        contactRevealedAt: threads.contactRevealedAt,
        lockedAt: threads.lockedAt,
        title: opportunities.title,
        orgName: organizations.name,
        providerUserId: providerProfiles.userId,
        providerName: providerProfiles.displayName,
      })
      .from(threads)
      .leftJoin(opportunities, eq(opportunities.id, threads.opportunityId))
      .leftJoin(organizations, eq(organizations.id, threads.organizationId))
      .leftJoin(providerProfiles, eq(providerProfiles.id, threads.providerProfileId))
      .where(eq(threads.id, id));
    // Thread must belong to the org the viewer is acting as right now.
    if (!thread || thread.organizationId !== org.id) return null;

    // Lazy join (DATABASE_SCHEMA §6): org members join on first view, which
    // is also what lets them read the messages (participant-only RLS).
    await ensureParticipant(tx, thread.id, user.id);
    await markThreadRead(tx, thread.id, user.id);
    const rows = await tx
      .select()
      .from(messages)
      .where(eq(messages.threadId, thread.id))
      .orderBy(asc(messages.createdAt));
    return { thread, rows };
  });
  if (!data) notFound();

  return (
    <div>
      <Link href="/b/messages" className="text-sm text-ink-soft hover:text-lilac">
        ← All messages
      </Link>
      <div className="mt-4">
        <ThreadView
          title={data.thread.title ?? "Opportunity"}
          opportunityHref={data.thread.title ? `/o/${data.thread.opportunityId}` : null}
          counterpartyName={data.thread.providerName ?? "Provider"}
          messages={data.rows}
          viewerUserId={user.id}
          providerUserId={data.thread.providerUserId ?? ""}
          providerName={data.thread.providerName ?? "Provider"}
          orgName={data.thread.orgName ?? "Business"}
          contactRevealed={data.thread.contactRevealedAt != null}
          locked={data.thread.lockedAt != null}
          composerAction={sendBusinessMessageAction}
          threadId={data.thread.id}
          error={error}
          warning={warning}
        />
      </div>
    </div>
  );
}
