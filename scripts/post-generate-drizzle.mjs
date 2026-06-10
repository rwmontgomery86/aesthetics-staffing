// drizzle-kit quotes PostGIS column types in generated SQL — e.g.
//   "geography(Point,4326)" — which Postgres rejects as an unknown type.
// This strips the quotes. Chained into `npm run db:generate`.
// (Same workaround NotifEyes ships; see its scripts/post-generate-drizzle.mjs.)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "drizzle";
let touched = 0;
for (const file of readdirSync(dir)) {
  if (!file.endsWith(".sql")) continue;
  const path = join(dir, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(/"(geography\([^)]+\))"/g, "$1");
  if (after !== before) {
    writeFileSync(path, after);
    touched++;
  }
}
console.log(`post-generate-drizzle: unquoted PostGIS types in ${touched} file(s)`);
