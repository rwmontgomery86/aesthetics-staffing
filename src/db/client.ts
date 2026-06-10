import "server-only";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

/**
 * THE user-facing database entrypoint. Everything here runs through the
 * `rls_client` role with per-transaction JWT-claim injection, so row-level
 * security applies to every query.
 *
 * Fail-closed by construction: rls_client is NOINHERIT with no privileges of
 * its own — if claim injection were ever skipped, queries return zero rows
 * (or privilege errors), never another user's data.
 *
 * set_config(..., true) is transaction-local, so this is safe through
 * Supabase's transaction pooler (port 6543).
 *
 * Do NOT export the raw pool or db from this module.
 */

const globalForDb = globalThis as unknown as { __rlsPool?: pg.Pool };

// Pool sizing is deliberate: Supabase's session pooler has a 15-connection
// ceiling shared across all clients (the NotifEyes worker crashed on this).
const rlsPool =
  globalForDb.__rlsPool ??
  new pg.Pool({ connectionString: process.env.DATABASE_URL_RLS, max: 5 });
globalForDb.__rlsPool = rlsPool;

const rlsDb: NodePgDatabase<typeof schema> = drizzle(rlsPool, { schema });

export type Tx = Parameters<Parameters<typeof rlsDb.transaction>[0]>[0];

export interface DbActor {
  id: string;
  /** Optional: lets policies match invite emails via auth.jwt()->>'email'. */
  email?: string | null;
}

/** Run `fn` as the given authenticated user, with RLS enforced. */
export async function dbAs<T>(actor: DbActor | string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const user = typeof actor === "string" ? { id: actor } : actor;
  const claims = JSON.stringify({
    sub: user.id,
    email: user.email ?? undefined,
    role: "authenticated",
  });
  return rlsDb.transaction(async (tx) => {
    await tx.execute(sql`
      select set_config('request.jwt.claims', ${claims}, true),
             set_config('role', 'authenticated', true)
    `);
    return fn(tx);
  });
}

/** Run `fn` as an anonymous visitor (public SEO pages, posted opportunities). */
export async function dbAsAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return rlsDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'anon', true)`);
    return fn(tx);
  });
}

/** Test/shutdown hook only — does not expose query capability. */
export async function endRlsPool(): Promise<void> {
  await rlsPool.end();
}
