import { asc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { portfolioItems, providerServices, services } from "@/db/schema";
import { FileUpload } from "@/components/FileUpload";
import { PortfolioGrid } from "@/components/PortfolioGrid";
import { requireProviderRow } from "@/lib/provider";
import { addPortfolioItemAction, removePortfolioItemAction } from "./actions";

export const metadata = { title: "Portfolio" };

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { user, provider }] = await Promise.all([
    searchParams,
    requireProviderRow(),
  ]);

  const data = await dbAs(user, async (tx) => ({
    items: await tx
      .select()
      .from(portfolioItems)
      .where(eq(portfolioItems.providerProfileId, provider.id))
      .orderBy(asc(portfolioItems.sort), asc(portfolioItems.createdAt)),
    myServices: await tx
      .select({ id: services.id, name: services.name })
      .from(providerServices)
      .innerJoin(services, eq(services.id, providerServices.serviceId))
      .where(eq(providerServices.providerProfileId, provider.id)),
  }));

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Portfolio</h1>
      <p className="mt-2 text-ink-soft">
        Visible <span className="font-medium text-ink">only</span> to businesses you apply to or
        personally approve — never public, never shown to other providers, never on search engines.
      </p>

      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      <div className="mt-8">
        <PortfolioGrid
          items={data.items.map((item) => ({ id: item.id, path: item.storagePath, caption: item.caption }))}
        />
        {data.items.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-ink-soft">Manage images</summary>
            <ul className="mt-2 space-y-1">
              {data.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between text-sm">
                  <span className="text-ink-soft">{item.caption || "Untitled image"}</span>
                  <form action={removePortfolioItemAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" className="oc-btn-ghost text-danger">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <form action={addPortfolioItemAction} className="oc-card mt-8 space-y-4 p-6">
        <h2 className="text-lg font-semibold">Add an image</h2>
        <FileUpload bucket="portfolios" userId={user.id} name="image" label="Choose image" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="oc-label">Caption (optional)</label>
            <input name="caption" maxLength={140} className="oc-input" />
          </div>
          <div>
            <label className="oc-label">Service (optional)</label>
            <select name="serviceId" className="oc-input" defaultValue="">
              <option value="">—</option>
              {data.myServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-xs text-ink-soft">
          <input type="checkbox" name="consent" className="mt-0.5" required />
          <span>
            I attest that I have the legal right and documented consent to share this image, and
            that it contains no patient-identifying information.
          </span>
        </label>
        <button type="submit" className="oc-btn">
          Add to portfolio
        </button>
      </form>
    </div>
  );
}
