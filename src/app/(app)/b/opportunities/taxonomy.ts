import "server-only";
import { asc, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { locations, providerTypes, serviceCategories, services } from "@/db/schema";
import type { TaxonomyData } from "./OpportunityFormFields";

/** Everything the opportunity form needs to render its checkboxes/selects. */
export async function loadTaxonomy(tx: Tx, organizationId: string): Promise<TaxonomyData> {
  return {
    providerTypes: await tx
      .select({ id: providerTypes.id, name: providerTypes.name })
      .from(providerTypes)
      .where(eq(providerTypes.active, true))
      .orderBy(asc(providerTypes.sort)),
    categories: await tx
      .select({ id: serviceCategories.id, name: serviceCategories.name, riskTier: serviceCategories.riskTier })
      .from(serviceCategories)
      .where(eq(serviceCategories.active, true))
      .orderBy(asc(serviceCategories.sort)),
    services: await tx
      .select({ id: services.id, name: services.name, categoryId: services.categoryId })
      .from(services)
      .where(eq(services.active, true))
      .orderBy(asc(services.sort)),
    locations: await tx
      .select({ id: locations.id, name: locations.name, city: locations.city, active: locations.active })
      .from(locations)
      .where(eq(locations.organizationId, organizationId))
      .orderBy(asc(locations.createdAt)),
  };
}
