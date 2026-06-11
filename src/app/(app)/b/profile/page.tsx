import { eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { organizations } from "@/db/schema";
import { FileUpload } from "@/components/FileUpload";
import { requireActiveOrg } from "@/lib/org";
import { ORG_KINDS } from "@/lib/org-kinds";
import { updateOrganizationAction } from "./actions";

export const metadata = { title: "Business profile" };

export default async function BusinessProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { contexts, org }] = await Promise.all([
    searchParams,
    requireActiveOrg("admin"),
  ]);

  const [orgRow] = await dbAs({ id: contexts.user.id, email: contexts.user.email }, (tx) =>
    tx.select().from(organizations).where(eq(organizations.id, org.id)),
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Business profile</h1>
      <p className="mt-2 text-ink-soft">
        What providers see when your opportunities match their zones or they look you up.
      </p>

      <form action={updateOrganizationAction} className="oc-card mt-8 space-y-5 p-6">
        <input type="hidden" name="organizationId" value={org.id} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="oc-label">
              Business name
            </label>
            <input id="name" name="name" required defaultValue={orgRow.name} className="oc-input" />
          </div>
          <div>
            <label htmlFor="kind" className="oc-label">
              Business type
            </label>
            <select id="kind" name="kind" defaultValue={orgRow.kind} className="oc-input">
              {ORG_KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="description" className="oc-label">
            About your business
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={orgRow.description ?? ""}
            placeholder="Your services, vibe, clientele, and what providers can expect working with you."
            className="oc-input"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="website" className="oc-label">
              Website (optional)
            </label>
            <input
              id="website"
              name="website"
              type="url"
              defaultValue={orgRow.website ?? ""}
              placeholder="https://example.com"
              className="oc-input"
            />
          </div>
          <div>
            <label htmlFor="phone" className="oc-label">
              Phone (optional)
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={orgRow.phone ?? ""}
              placeholder="(404) 555-0100"
              className="oc-input"
            />
          </div>
        </div>

        <div>
          <label htmlFor="softwareEmrPos" className="oc-label">
            Software / EMR / POS (optional)
          </label>
          <input
            id="softwareEmrPos"
            name="softwareEmrPos"
            defaultValue={orgRow.softwareEmrPos ?? ""}
            placeholder="e.g. Boulevard, Aesthetic Record, Square"
            className="oc-input"
          />
          <p className="mt-1 text-xs text-ink-soft">
            Helps providers know what they&apos;ll be working with.
          </p>
        </div>

        <div>
          <span className="oc-label">Logo (optional)</span>
          <FileUpload
            bucket="org-media"
            userId={contexts.user.id}
            pathPrefix={org.id}
            name="logo"
            label={orgRow.logoPath ? "Replace logo" : "Upload logo"}
            currentFileName={orgRow.logoPath ? "Logo on file ✓" : null}
          />
        </div>

        <p className="rounded-lg border border-line p-3 text-sm text-ink-soft">
          Public link name: <span className="font-mono text-ink">{orgRow.slug}</span> — used in
          opportunity pages later. It stays stable even if you rename the business.
        </p>

        {error ? <p className="oc-error">{error}</p> : null}
        {notice ? <p className="oc-notice">{notice}</p> : null}
        <button type="submit" className="oc-btn">
          Save profile
        </button>
      </form>
    </div>
  );
}
