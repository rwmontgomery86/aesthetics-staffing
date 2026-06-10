import { serviceDb } from "../service";
import { providerTypes, serviceCategories, services } from "../schema";

/** Idempotent: upserts by slug. */
export async function seedTaxonomy() {
  const providerTypeRows = [
    { slug: "injector_rn", name: "Registered Nurse Injector", requiresStateLicense: true, sort: 10 },
    { slug: "injector_np", name: "Nurse Practitioner (APRN) Injector", requiresStateLicense: true, sort: 20 },
    { slug: "injector_pa", name: "Physician Assistant Injector", requiresStateLicense: true, sort: 30 },
    { slug: "injector_md_do", name: "Physician Injector (MD/DO)", requiresStateLicense: true, sort: 40 },
    { slug: "aesthetician", name: "Aesthetician", requiresStateLicense: true, sort: 50 },
    { slug: "laser_technician", name: "Laser Technician", requiresStateLicense: false, sort: 60 },
    { slug: "massage_therapist", name: "Massage Therapist", requiresStateLicense: true, sort: 70 },
    { slug: "makeup_artist", name: "Makeup Artist", requiresStateLicense: false, sort: 80 },
    { slug: "wellness_provider", name: "Wellness Provider", requiresStateLicense: false, sort: 90 },
  ];
  for (const row of providerTypeRows) {
    await serviceDb
      .insert(providerTypes)
      .values(row)
      .onConflictDoUpdate({ target: providerTypes.slug, set: row });
  }

  // risk_tier: 3 = review-queue priority (injectables/laser/IV), 1 = low.
  const categoryRows = [
    { slug: "injectables", name: "Injectables", riskTier: 3, sort: 10 },
    { slug: "laser_energy", name: "Laser & Energy Devices", riskTier: 3, sort: 20 },
    { slug: "iv_wellness", name: "IV Therapy & Wellness", riskTier: 3, sort: 30 },
    { slug: "advanced_aesthetics", name: "Advanced Aesthetics", riskTier: 2, sort: 40 },
    { slug: "massage_bodywork", name: "Massage & Bodywork", riskTier: 2, sort: 50 },
    { slug: "skincare", name: "Skincare & Facials", riskTier: 1, sort: 60 },
    { slug: "waxing_lashes_brows", name: "Waxing, Lashes & Brows", riskTier: 1, sort: 70 },
    { slug: "makeup_artistry", name: "Makeup & Beauty", riskTier: 1, sort: 80 },
  ];
  for (const row of categoryRows) {
    await serviceDb
      .insert(serviceCategories)
      .values(row)
      .onConflictDoUpdate({ target: serviceCategories.slug, set: row });
  }

  const categories = await serviceDb.select().from(serviceCategories);
  const catId = (slug: string) => {
    const found = categories.find((c) => c.slug === slug);
    if (!found) throw new Error(`missing category ${slug}`);
    return found.id;
  };

  const serviceRows: Array<{ category: string; slug: string; name: string; sort: number }> = [
    { category: "injectables", slug: "neurotoxin", name: "Neurotoxin (Botox/Dysport/Jeuveau)", sort: 10 },
    { category: "injectables", slug: "dermal_filler", name: "Dermal Filler", sort: 20 },
    { category: "injectables", slug: "lip_filler", name: "Lip Filler", sort: 30 },
    { category: "injectables", slug: "kybella", name: "Kybella / Deoxycholic Acid", sort: 40 },
    { category: "injectables", slug: "prp_injections", name: "PRP Injections", sort: 50 },
    { category: "injectables", slug: "sclerotherapy", name: "Sclerotherapy", sort: 60 },
    { category: "laser_energy", slug: "laser_hair_removal", name: "Laser Hair Removal", sort: 10 },
    { category: "laser_energy", slug: "ipl_photofacial", name: "IPL Photofacial", sort: 20 },
    { category: "laser_energy", slug: "laser_resurfacing", name: "Laser Skin Resurfacing (CO2/Erbium)", sort: 30 },
    { category: "laser_energy", slug: "rf_skin_tightening", name: "RF Skin Tightening", sort: 40 },
    { category: "laser_energy", slug: "body_contouring", name: "Body Contouring", sort: 50 },
    { category: "laser_energy", slug: "laser_tattoo_removal", name: "Laser Tattoo Removal", sort: 60 },
    { category: "iv_wellness", slug: "iv_hydration", name: "IV Hydration Therapy", sort: 10 },
    { category: "iv_wellness", slug: "vitamin_injections", name: "Vitamin Injections (B12 etc.)", sort: 20 },
    { category: "iv_wellness", slug: "weight_loss_injections", name: "Medical Weight-Loss Injections", sort: 30 },
    { category: "advanced_aesthetics", slug: "microneedling", name: "Microneedling", sort: 10 },
    { category: "advanced_aesthetics", slug: "chemical_peel_medium", name: "Medium-Depth Chemical Peels", sort: 20 },
    { category: "advanced_aesthetics", slug: "pmu_microblading", name: "Permanent Makeup / Microblading", sort: 30 },
    { category: "skincare", slug: "facials", name: "Facials", sort: 10 },
    { category: "skincare", slug: "hydrafacial", name: "HydraFacial", sort: 20 },
    { category: "skincare", slug: "dermaplaning", name: "Dermaplaning", sort: 30 },
    { category: "skincare", slug: "chemical_peel_light", name: "Light Chemical Peels", sort: 40 },
    { category: "skincare", slug: "led_therapy", name: "LED Light Therapy", sort: 50 },
    { category: "massage_bodywork", slug: "swedish_massage", name: "Swedish Massage", sort: 10 },
    { category: "massage_bodywork", slug: "deep_tissue_massage", name: "Deep Tissue Massage", sort: 20 },
    { category: "massage_bodywork", slug: "prenatal_massage", name: "Prenatal Massage", sort: 30 },
    { category: "massage_bodywork", slug: "sports_massage", name: "Sports Massage", sort: 40 },
    { category: "massage_bodywork", slug: "lymphatic_drainage", name: "Lymphatic Drainage", sort: 50 },
    { category: "massage_bodywork", slug: "hot_stone_massage", name: "Hot Stone Massage", sort: 60 },
    { category: "waxing_lashes_brows", slug: "waxing", name: "Waxing", sort: 10 },
    { category: "waxing_lashes_brows", slug: "lash_extensions", name: "Lash Extensions", sort: 20 },
    { category: "waxing_lashes_brows", slug: "lash_lift_tint", name: "Lash Lift & Tint", sort: 30 },
    { category: "waxing_lashes_brows", slug: "brow_lamination", name: "Brow Lamination", sort: 40 },
    { category: "waxing_lashes_brows", slug: "brow_shaping_tint", name: "Brow Shaping & Tint", sort: 50 },
    { category: "makeup_artistry", slug: "bridal_makeup", name: "Bridal Makeup", sort: 10 },
    { category: "makeup_artistry", slug: "event_makeup", name: "Event Makeup", sort: 20 },
    { category: "makeup_artistry", slug: "editorial_makeup", name: "Editorial Makeup", sort: 30 },
    { category: "makeup_artistry", slug: "makeup_lessons", name: "Makeup Lessons", sort: 40 },
  ];
  for (const row of serviceRows) {
    const values = { categoryId: catId(row.category), slug: row.slug, name: row.name, sort: row.sort };
    await serviceDb
      .insert(services)
      .values(values)
      .onConflictDoUpdate({ target: services.slug, set: values });
  }

  const typeCount = (await serviceDb.select().from(providerTypes)).length;
  const svcCount = (await serviceDb.select().from(services)).length;
  console.log(`✓ taxonomy: ${typeCount} provider types, ${categories.length} categories, ${svcCount} services`);
}

// Allow `tsx src/db/seed/taxonomy.ts` direct runs.
if (process.argv[1]?.endsWith("taxonomy.ts")) {
  seedTaxonomy().then(() => process.exit(0));
}
