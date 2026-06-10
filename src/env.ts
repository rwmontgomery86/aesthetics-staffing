import "server-only";
import { z } from "zod";

/**
 * Validated server environment. Optional integrations degrade to console
 * stubs (NotifEyes pattern) — absence must never crash dev/CI.
 */
const envSchema = z.object({
  // Service connection — bypasses RLS; worker/migrations/matching/webhooks only.
  DATABASE_URL_SERVICE: z.string().url(),
  // RLS-enforced connection used by dbAs(); connects as rls_client.
  DATABASE_URL_RLS: z.string().url(),
  RLS_CLIENT_PASSWORD: z.string().min(8).default("rls-client-dev"),

  // Brand is config, not code — the working name is tentative.
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("OpenChair"),
  APP_BASE_URL: z.string().url().default("http://localhost:4000"),
  EMAIL_FROM: z.string().min(3).default("OpenChair <hello@example.test>"),
  SUPPORT_EMAIL: z.string().email().default("support@example.test"),

  // Optional integrations.
  RESEND_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  MAPBOX_TOKEN: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = envSchema.parse(process.env);
