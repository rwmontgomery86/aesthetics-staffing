import "server-only";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * ⚠️ SERVICE-ROLE database access — BYPASSES row-level security.
 *
 * Importable ONLY by:
 *   - src/workers/**            (fanout must read across all providers' zones)
 *   - src/lib/matching*         (the matching engine)
 *   - src/db/**                 (migrations, seeds)
 *   - src/app/api/webhooks/**   (Twilio/Resend callbacks — no user session)
 *
 * The ESLint no-restricted-imports fence (eslint.config.mjs) blocks everything
 * else. User-facing code goes through dbAs() in src/db/client.ts.
 */

const globalForDb = globalThis as unknown as { __servicePool?: pg.Pool };

// Capped: Supabase session pooler ceiling is 15 connections TOTAL across
// app + worker + any LISTEN pools (hard-learned in NotifEyes).
const servicePool =
  globalForDb.__servicePool ??
  new pg.Pool({ connectionString: process.env.DATABASE_URL_SERVICE, max: 5 });
globalForDb.__servicePool = servicePool;

export const serviceDb: NodePgDatabase<typeof schema> = drizzle(servicePool, { schema });
export { servicePool };
