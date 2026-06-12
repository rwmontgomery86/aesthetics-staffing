import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  messages,
  opportunities,
  organizations,
  providerProfiles,
  threads,
} from "@/db/schema";
import { ThreadView } from "@/components/messaging/ThreadView";
import { requireAdmin } from "@/lib/auth/guards";

export const metadata = { title: "Thread — admin" };

/**
 * Read-only admin view (COMPLIANCE_AND_TRUST: admin review possible because
 * admins can read threads — LOGGED via audit). Every load writes
 * thread.viewed; flagged messages are marked inline.
 */
export default async function AdminThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, contexts] = await Promise.all([params, requireAdmin()]);
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
    if (!thread) return null;

    await tx.execute(sql`
      select public.record_audit(
        'admin', 'thread.viewed', 'thread', ${thread.id}::uuid, ${thread.organizationId}::uuid
      )
    `);
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
      <Link href="/admin/threads" className="text-sm text-ink-soft hover:text-lilac">
        ← All threads
      </Link>
      <div className="mt-4">
        <ThreadView
          title={data.thread.title ?? "Opportunity"}
          opportunityHref={data.thread.title ? `/o/${data.thread.opportunityId}` : null}
          counterpartyName={`${data.thread.providerName ?? "Provider"} ↔ ${data.thread.orgName ?? "Business"}`}
          messages={data.rows}
          viewerUserId={null}
          providerUserId={data.thread.providerUserId ?? ""}
          providerName={data.thread.providerName ?? "Provider"}
          orgName={data.thread.orgName ?? "Business"}
          contactRevealed={data.thread.contactRevealedAt != null}
          locked={data.thread.lockedAt != null}
          showFlags
        />
      </div>
    </div>
  );
}
