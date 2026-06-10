import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest doesn't read .env on its own (npm scripts use --env-file-if-exists).
// .env.test wins so the test suite stays on the LOCAL database even when .env
// points the app at hosted Supabase. CI injects env vars directly.
for (const file of [".env.test", ".env"]) {
  try {
    process.loadEnvFile(path.resolve(__dirname, file));
    break;
  } catch {
    // try the next file
  }
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Tests run outside Next.js — neutralize the server-only guard.
      "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // RLS tests share one database; serialize to keep fixtures deterministic.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
