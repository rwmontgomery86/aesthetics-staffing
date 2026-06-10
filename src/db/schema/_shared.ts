import { sql } from "drizzle-orm";
import { customType, pgRole } from "drizzle-orm/pg-core";

// ── PostGIS column types ────────────────────────────────────────────────────
// drizzle-kit quotes these in generated SQL; scripts/post-generate-drizzle.mjs
// strips the quotes (run via `npm run db:generate`).

export const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(Geometry, 4326)";
  },
});

export const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(Point, 4326)";
  },
});

export const geographyMultiPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(MultiPolygon, 4326)";
  },
});

// ── Database roles (provisioned by bootstrap SQL / Supabase — never created
//    by drizzle migrations) ──────────────────────────────────────────────────

export const anonRole = pgRole("anon").existing();
export const authenticatedRole = pgRole("authenticated").existing();

// ── RLS policy fragments ────────────────────────────────────────────────────
// Helper functions are SECURITY DEFINER, created in drizzle/bootstrap/.
// Each is wrapped in (select …) so Postgres caches it per statement (InitPlan)
// instead of re-evaluating per row.

export const isAdmin = sql`(select public.is_platform_admin())`;
export const myProviderId = sql`(select public.my_provider_profile_id())`;
export const authUid = sql`(select auth.uid())`;
