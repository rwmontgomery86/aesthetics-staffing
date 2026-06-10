import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  credentialRequirements,
  credentialTypes,
  providerCredentials,
  providerProfileTypes,
  providerServices,
  services,
} from "@/db/schema";

/**
 * The credential requirements engine (warn-don't-block).
 *
 * Applicable requirements for a provider = UNION of rows attached to
 *   - any of their provider types
 *   - any of their services
 *   - any of their services' categories
 * scoped to state (state = launch state or NULL = nationwide), keeping the
 * strictest level when several rows name the same credential type
 * (required > recommended).
 *
 * Credential completeness NEVER gates matching or applying — it renders
 * warning chips for the provider and honest labels for businesses.
 */

export type RequirementLevel = "required" | "recommended";

export interface RequirementInput {
  credentialTypeId: string;
  level: RequirementLevel;
}

export interface CredentialInput {
  id: string;
  credentialTypeId: string;
  status:
    | "not_provided"
    | "self_attested"
    | "document_uploaded"
    | "needs_review"
    | "admin_reviewed"
    | "rejected_needs_info";
  expiresAt: string | null; // ISO date
}

export interface CredentialChipData {
  credentialTypeId: string;
  level: RequirementLevel | null; // null = held but not required/recommended
  status: CredentialInput["status"];
  credentialId: string | null;
  expiresAt: string | null;
  /** Derived from expires_at — never stored, can't go stale. */
  derived: "expired" | "expiring_soon" | null;
  /** Required + effectively missing → the provider-facing warning chip. */
  isWarning: boolean;
}

export const EXPIRING_SOON_DAYS = 30;

export function deriveExpiry(expiresAt: string | null, today: Date): "expired" | "expiring_soon" | null {
  if (!expiresAt) return null;
  const expiry = new Date(`${expiresAt}T23:59:59`);
  if (expiry < today) return "expired";
  const soon = new Date(today);
  soon.setDate(soon.getDate() + EXPIRING_SOON_DAYS);
  return expiry <= soon ? "expiring_soon" : null;
}

/** Pure core — unit-tested without a database. */
export function summarizeRequirements(
  requirements: RequirementInput[],
  credentials: CredentialInput[],
  today: Date = new Date(),
): CredentialChipData[] {
  // Union with strictest level per credential type.
  const levelByType = new Map<string, RequirementLevel>();
  for (const requirement of requirements) {
    const existing = levelByType.get(requirement.credentialTypeId);
    if (existing === "required") continue;
    levelByType.set(requirement.credentialTypeId, requirement.level);
  }

  const credentialByType = new Map(credentials.map((c) => [c.credentialTypeId, c]));
  const chips: CredentialChipData[] = [];

  for (const [credentialTypeId, level] of levelByType) {
    const credential = credentialByType.get(credentialTypeId) ?? null;
    const status = credential?.status ?? "not_provided";
    const derived = deriveExpiry(credential?.expiresAt ?? null, today);
    const effectivelyMissing =
      status === "not_provided" || status === "rejected_needs_info" || derived === "expired";
    chips.push({
      credentialTypeId,
      level,
      status,
      credentialId: credential?.id ?? null,
      expiresAt: credential?.expiresAt ?? null,
      derived,
      isWarning: level === "required" && effectivelyMissing,
    });
  }

  // Credentials the provider holds beyond any requirement.
  for (const credential of credentials) {
    if (levelByType.has(credential.credentialTypeId)) continue;
    chips.push({
      credentialTypeId: credential.credentialTypeId,
      level: null,
      status: credential.status,
      credentialId: credential.id,
      expiresAt: credential.expiresAt,
      derived: deriveExpiry(credential.expiresAt, today),
      isWarning: false,
    });
  }

  // Required warnings first, then required, recommended, extras.
  const rank = (chip: CredentialChipData) =>
    chip.isWarning ? 0 : chip.level === "required" ? 1 : chip.level === "recommended" ? 2 : 3;
  return chips.sort((a, b) => rank(a) - rank(b));
}

/** DB wrapper: gather inputs for the signed-in provider and summarize. */
export async function getCredentialSummary(tx: Tx, providerProfileId: string, state: string) {
  const myTypes = await tx
    .select({ id: providerProfileTypes.providerTypeId })
    .from(providerProfileTypes)
    .where(eq(providerProfileTypes.providerProfileId, providerProfileId));
  const myServices = await tx
    .select({ serviceId: providerServices.serviceId, categoryId: services.categoryId })
    .from(providerServices)
    .innerJoin(services, eq(services.id, providerServices.serviceId))
    .where(eq(providerServices.providerProfileId, providerProfileId));

  const typeIds = myTypes.map((row) => row.id);
  const serviceIds = myServices.map((row) => row.serviceId);
  const categoryIds = [...new Set(myServices.map((row) => row.categoryId))];

  const attachmentClauses = [
    typeIds.length > 0 ? inArray(credentialRequirements.providerTypeId, typeIds) : sql`false`,
    serviceIds.length > 0 ? inArray(credentialRequirements.serviceId, serviceIds) : sql`false`,
    categoryIds.length > 0 ? inArray(credentialRequirements.serviceCategoryId, categoryIds) : sql`false`,
  ];

  const requirementRows = await tx
    .select({
      credentialTypeId: credentialRequirements.credentialTypeId,
      level: credentialRequirements.level,
    })
    .from(credentialRequirements)
    .where(
      and(
        eq(credentialRequirements.active, true),
        or(eq(credentialRequirements.state, state), isNull(credentialRequirements.state)),
        or(...attachmentClauses),
      ),
    );

  const credentialRows = await tx
    .select({
      id: providerCredentials.id,
      credentialTypeId: providerCredentials.credentialTypeId,
      status: providerCredentials.status,
      expiresAt: providerCredentials.expiresAt,
    })
    .from(providerCredentials)
    .where(eq(providerCredentials.providerProfileId, providerProfileId));

  const chips = summarizeRequirements(requirementRows, credentialRows);

  const allTypes = await tx.select().from(credentialTypes).where(eq(credentialTypes.active, true));
  const typeById = new Map(allTypes.map((type) => [type.id, type]));

  return { chips, typeById, allTypes };
}
