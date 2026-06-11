import "server-only";
import PgBoss from "pg-boss";

/**
 * The pg-boss handle — ONE instance per process, shared by producers (server
 * actions, the dispatcher) and the worker (which registers handlers on it).
 *
 * Connection budget (hard-learned in NotifEyes): pg-boss runs on the SESSION
 * pooler (DATABASE_URL_SERVICE, :5432) with max 5; the service Drizzle pool
 * is another 5. Supavisor's session pool_size is 15 — keep the sum under it.
 * pg-boss polls; it never uses LISTEN/NOTIFY (Supavisor drops it).
 */

export const QUEUES = {
  fanoutPosted: "fanout-opportunity-posted",
  fanoutUpdated: "fanout-opportunity-updated",
  deliverEmail: "deliver-email",
  deliverSms: "deliver-sms",
  generateOccurrences: "generate-occurrences",
  expireOpportunities: "expire-opportunities",
  credentialExpiryScan: "credential-expiry-scan",
  bookingReminders: "booking-reminders",
  applicationStaleNudge: "application-stale-nudge",
} as const;

const globalForBoss = globalThis as unknown as { __pgBoss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.__pgBoss) {
    globalForBoss.__pgBoss = (async () => {
      const boss = new PgBoss({
        connectionString: process.env.DATABASE_URL_SERVICE,
        max: 5,
      });
      boss.on("error", (err) => console.error("[pg-boss]", err));
      await boss.start();
      // v10 requires queues to exist before send/work. Idempotent, and done
      // on BOTH sides so producer and worker can start in any order.
      for (const name of Object.values(QUEUES)) {
        await boss.createQueue(name);
      }
      return boss;
    })();
  }
  return globalForBoss.__pgBoss;
}

/** Test/shutdown hook: closes the boss pool so processes can exit. */
export async function stopBoss(): Promise<void> {
  if (!globalForBoss.__pgBoss) return;
  const boss = await globalForBoss.__pgBoss;
  globalForBoss.__pgBoss = undefined;
  await boss.stop({ graceful: false, wait: true });
}

/** Delivery sends get retries with backoff; fanout retries on its own dedup ledger. */
const DELIVER_OPTS: PgBoss.SendOptions = { retryLimit: 3, retryDelay: 30, retryBackoff: true };

export async function enqueueFanoutPosted(opportunityId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.fanoutPosted, { opportunityId }, { retryLimit: 2, retryDelay: 15 });
}

export async function enqueueFanoutUpdated(opportunityId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.fanoutUpdated, { opportunityId }, { retryLimit: 2, retryDelay: 15 });
}

export async function enqueueDeliverEmail(deliveryId: number): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.deliverEmail, { deliveryId }, DELIVER_OPTS);
}

export async function enqueueDeliverSms(deliveryId: number): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.deliverSms, { deliveryId }, DELIVER_OPTS);
}

/**
 * Posting must never fail because the queue hiccuped — alerts are
 * eventually-consistent (the founder can re-run fanout), a lost post is not.
 */
export async function tryEnqueue(fn: () => Promise<void>, label: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[queue] enqueue ${label} failed (post continues):`, err);
  }
}
