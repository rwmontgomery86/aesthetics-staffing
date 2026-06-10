import { seedTaxonomy } from "./taxonomy";
import { seedCredentials } from "./credentials";
import { servicePool } from "../service";

/** Production-safe seeds: reference data only. Demo data is `npm run db:seed:demo`. */
async function main() {
  await seedTaxonomy();
  await seedCredentials();
  await servicePool.end();
  console.log("✓ seed complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
