import { asc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  providerProfileTypes,
  providerServices,
  providerTypes,
  serviceCategories,
  services,
} from "@/db/schema";
import { requireProviderRow } from "@/lib/provider";
import { updateServicesAction } from "./actions";

export const metadata = { title: "Services" };

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { user, provider }] = await Promise.all([
    searchParams,
    requireProviderRow(),
  ]);

  const data = await dbAs(user, async (tx) => ({
    types: await tx.select().from(providerTypes).where(eq(providerTypes.active, true)).orderBy(asc(providerTypes.sort)),
    categories: await tx
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.active, true))
      .orderBy(asc(serviceCategories.sort)),
    services: await tx.select().from(services).where(eq(services.active, true)).orderBy(asc(services.sort)),
    myTypes: await tx
      .select({ id: providerProfileTypes.providerTypeId })
      .from(providerProfileTypes)
      .where(eq(providerProfileTypes.providerProfileId, provider.id)),
    myServices: await tx
      .select({ id: providerServices.serviceId })
      .from(providerServices)
      .where(eq(providerServices.providerProfileId, provider.id)),
  }));

  const myTypeIds = new Set(data.myTypes.map((row) => row.id));
  const myServiceIds = new Set(data.myServices.map((row) => row.id));

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Categories &amp; services</h1>
      <p className="mt-2 text-ink-soft">
        These drive your matches — you&apos;ll only be alerted for opportunities that need what you
        offer.
      </p>

      <form action={updateServicesAction} className="mt-8 space-y-8">
        <section className="oc-card p-6">
          <h2 className="text-lg font-semibold">I am a…</h2>
          <p className="mt-1 text-sm text-ink-soft">Pick every category that applies.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {data.types.map((type) => (
              <label
                key={type.id}
                className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-sm hover:border-lilac-soft"
              >
                <input type="checkbox" name="ptype" value={type.id} defaultChecked={myTypeIds.has(type.id)} />
                {type.name}
              </label>
            ))}
          </div>
        </section>

        <section className="oc-card p-6">
          <h2 className="text-lg font-semibold">Services I offer</h2>
          {data.categories.map((category) => {
            const categoryServices = data.services.filter((s) => s.categoryId === category.id);
            if (categoryServices.length === 0) return null;
            return (
              <div key={category.id} className="mt-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  {category.name}
                </h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {categoryServices.map((service) => (
                    <label
                      key={service.id}
                      className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:border-lilac-soft"
                    >
                      <input
                        type="checkbox"
                        name="service"
                        value={service.id}
                        defaultChecked={myServiceIds.has(service.id)}
                      />
                      {service.name}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {error ? <p className="oc-error">{error}</p> : null}
        {notice ? <p className="oc-notice">{notice}</p> : null}
        <button type="submit" className="oc-btn">
          Save services
        </button>
      </form>
    </div>
  );
}
