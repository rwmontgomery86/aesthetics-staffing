import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { messages, opportunities, organizations, threads } from "@/db/schema";
import { ThreadView } from "@/components/messaging/ThreadView";
import { ensureParticipant, markThreadRead } from "@/lib/messaging/threads";
import { requireProviderRow } from "@/lib/provider";
import { sendProviderMessageAction } from "../actions";

export const metadata = { title: "Conversation" };

export default async function ProviderThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; warning?: string }>;
}) {
  const [{ id }, { error, warning }, { user, provider }] = await Promise.all([
    params,
    searchParams,
    requireProviderRow(),
  ]);

  const data = await dbAs(user, async (tx) => {
    const [thread] = await tx
      .select({
        id: threads.id,
        providerProfileId: threads.providerProfileId,
        opportunityId: threads.opportunityId,
        contactRevealedAt: threads.contactRevealedAt,
        lockedAt: threads.lockedAt,
        title: opportunities.title,
        orgName: organizations.name,
      })
      .from(threads)
      .leftJoin(opportunities, eq(opportunities.id, threads.opportunityId))
      .leftJoin(organizations, eq(organizations.id, threads.organizationId))
      .where(eq(threads.id, id));
    // Wrong hat (e.g. an org member pasting a /p link) bounces to their side.
    if (!thread || thread.providerProfileId !== provider.id) return null;

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
      <Link href="/p/messages" className="text-sm text-ink-soft hover:text-lilac">
        ← All messages
      </Link>
      <div className="mt-4">
        <ThreadView
          title={data.thread.title ?? "Opportunity"}
          opportunityHref={data.thread.title ? `/o/${data.thread.opportunityId}` : null}
          counterpartyName={data.thread.orgName ?? "Business"}
          messages={data.rows}
          viewerUserId={user.id}
          providerUserId={user.id}
          providerName={provider.displayName}
          orgName={data.thread.orgName ?? "Business"}
          contactRevealed={data.thread.contactRevealedAt != null}
          locked={data.thread.lockedAt != null}
          composerAction={sendProviderMessageAction}
          threadId={data.thread.id}
          error={error}
          warning={warning}
        />
      </div>
    </div>
  );
}
