import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Migration runner. Order matters:
 *   1. drizzle/bootstrap/0000_bootstrap.sql — idempotent, re-run every time
 *      (extensions, roles, auth shim, SECURITY DEFINER policy helpers; these
 *      must exist before drizzle migrations because pgPolicy definitions
 *      reference them).
 *   2. drizzle migrations (generated; tables + RLS policies).
 *   3. drizzle/manual/*.sql — applied once each, tracked in
 *      public.manual_migrations (checks, FKs to auth schema, triggers,
 *      grants, GIST/GIN indexes).
 *
 * Standalone on purpose: reads process.env directly so it runs the same via
 * `npm run db:migrate` locally and inside CI.
 */

const serviceUrl = process.env.DATABASE_URL_SERVICE;
if (!serviceUrl) {
  console.error("DATABASE_URL_SERVICE is required");
  process.exit(1);
}
const rlsPassword = process.env.RLS_CLIENT_PASSWORD ?? "rls-client-dev";

async function main() {
  const client = new pg.Client({ connectionString: serviceUrl });
  await client.connect();

  console.log("→ bootstrap");
  const bootstrap = readFileSync("drizzle/bootstrap/0000_bootstrap.sql", "utf8").replaceAll(
    "__RLS_CLIENT_PASSWORD__",
    rlsPassword.replaceAll("'", "''"),
  );
  await client.query(bootstrap);

  console.log("→ drizzle migrations");
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });

  console.log("→ manual migrations");
  await client.query(`
    create table if not exists public.manual_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const manualDir = "drizzle/manual";
  const files = readdirSync(manualDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const applied = await client.query("select 1 from public.manual_migrations where name = $1", [
      file,
    ]);
    if (applied.rowCount) continue;
    console.log(`  applying ${file}`);
    await client.query("begin");
    try {
      await client.query(readFileSync(path.join(manualDir, file), "utf8"));
      await client.query("insert into public.manual_migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  await client.end();
  console.log("✓ migrations complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
