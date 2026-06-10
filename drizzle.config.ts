import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // drizzle-kit is only used for `generate`; it never connects in our workflow,
    // but the config key is required.
    url: process.env.DATABASE_URL_SERVICE ?? "postgresql://localhost:5432/aesthetics_staffing",
  },
  entities: {
    roles: {
      // anon/authenticated/service_role are provisioned by bootstrap SQL (or by
      // Supabase itself in hosted environments) — drizzle-kit must not manage them.
      provider: "supabase",
    },
  },
});
