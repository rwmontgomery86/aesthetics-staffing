import { getBoss, QUEUES } from "@/lib/queue";
import { fanoutOpportunityPosted, fanoutOpportunityUpdated } from "@/lib/matching/fanout";
import { deliverEmailJob, deliverSmsJob } from "./jobs/deliver";
import {
  applicationStaleNudgeJob,
  bookingRemindersJob,
  credentialExpiryScanJob,
  expireOpportunitiesJob,
  generateOccurrencesJob,
} from "./jobs/crons";
import { servicePool } from "@/db/service";

/**
 * The worker process (`npm run worker`) — pg-boss consumer + cron host.
 * Runs anywhere Node runs (Railway in production, a laptop in dev); connects
 * to the same Postgres as the app. Connection math: pg-boss pool (5) +
 * service pool (5) on the session pooler, under Supavisor's ceiling of 15.
 *
 * Every handler is idempotent; pg-boss retries are safe by construction
 * (dedup ledger, unique indexes, status guards, notification dedup).
 */

interface OpportunityJobData {
  opportunityId: string;
}

interface DeliveryJobData {
  deliveryId: number;
}

async function main() {
  const boss = await getBoss();

  await boss.work<OpportunityJobData>(QUEUES.fanoutPosted, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      await fanoutOpportunityPosted(job.data.opportunityId);
    }
  });

  await boss.work<OpportunityJobData>(QUEUES.fanoutUpdated, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      await fanoutOpportunityUpdated(job.data.opportunityId);
    }
  });

  await boss.work<DeliveryJobData>(QUEUES.deliverEmail, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) {
      await deliverEmailJob(job.data.deliveryId);
    }
  });

  await boss.work<DeliveryJobData>(QUEUES.deliverSms, { batchSize: 10 }, async (jobs) => {
    for (const job of jobs) {
      await deliverSmsJob(job.data.deliveryId);
    }
  });

  await boss.work(QUEUES.generateOccurrences, async () => generateOccurrencesJob());
  await boss.work(QUEUES.expireOpportunities, async () => expireOpportunitiesJob());
  await boss.work(QUEUES.credentialExpiryScan, async () => credentialExpiryScanJob());
  await boss.work(QUEUES.bookingReminders, async () => bookingRemindersJob());
  await boss.work(QUEUES.applicationStaleNudge, async () => applicationStaleNudgeJob());

  // Crons (UTC). Georgia is UTC-4/-5; the early-morning jobs land overnight ET.
  await boss.schedule(QUEUES.generateOccurrences, "15 6 * * *"); // ~1–2am ET daily
  await boss.schedule(QUEUES.expireOpportunities, "5 * * * *"); // hourly
  await boss.schedule(QUEUES.credentialExpiryScan, "0 13 * * *"); // ~8–9am ET daily
  await boss.schedule(QUEUES.bookingReminders, "*/15 * * * *");
  await boss.schedule(QUEUES.applicationStaleNudge, "0 */6 * * *");

  // Kick the maintenance crons once so a fresh deploy doesn't wait a cycle.
  await boss.send(QUEUES.expireOpportunities, {});
  await boss.send(QUEUES.generateOccurrences, {});

  console.log("[worker] running — queues registered, crons scheduled");

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      console.log(`\n[worker] ${sig} received, stopping…`);
      await boss.stop();
      await servicePool.end();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
