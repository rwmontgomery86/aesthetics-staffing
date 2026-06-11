import { NextResponse } from "next/server";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { notifications } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";

/**
 * The bell's polling endpoint (~25s cadence — see NotificationsBell). Runs
 * through dbAs(), so RLS scopes everything to the signed-in user.
 */

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const data = await dbAs({ id: user.id, email: user.email }, async (tx) => {
    const [unread] = await tx
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    const items = await tx
      .select({
        id: notifications.id,
        title: notifications.title,
        body: notifications.body,
        actionUrl: notifications.actionUrl,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(10);
    return { unread: unread.value, items };
  });

  return NextResponse.json(data);
}

export async function POST() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await dbAs({ id: user.id, email: user.email }, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
  );
  return NextResponse.json({ ok: true });
}
