import tseslint from "typescript-eslint";

/**
 * The load-bearing rule here is no-restricted-imports: src/db/service.ts is the
 * service-role pool that BYPASSES row-level security. Only the worker, the
 * matching engine, migrations/seeds, and webhook handlers may touch it. All
 * user-facing code must go through dbAs() in src/db/client.ts so RLS applies.
 */
export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "drizzle/**"],
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/db/service",
              message:
                "service-role DB access bypasses RLS. Use dbAs() from @/db/client. " +
                "Only src/workers/**, src/lib/matching*, src/db/**, and src/app/api/webhooks/** may import this.",
            },
          ],
          patterns: [
            {
              group: ["**/db/service"],
              message:
                "service-role DB access bypasses RLS. Use dbAs() from @/db/client. " +
                "Only src/workers/**, src/lib/matching*, src/db/**, and src/app/api/webhooks/** may import this.",
            },
          ],
        },
      ],
    },
  },
  {
    // The allowlist: trusted server-side code that legitimately needs to read
    // across users (fanout must see all providers' zones) or runs pre-auth.
    files: [
      "src/workers/**/*.ts",
      "src/lib/matching.ts",
      "src/lib/matching/**/*.ts",
      "src/db/**/*.ts",
      "src/app/api/webhooks/**/*.ts",
      "tests/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
