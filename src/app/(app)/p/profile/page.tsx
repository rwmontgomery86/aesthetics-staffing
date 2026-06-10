import { FileUpload } from "@/components/FileUpload";
import { requireProviderRow } from "@/lib/provider";
import { updateProfileAction } from "./actions";

export const metadata = { title: "Provider profile" };

export default async function ProviderProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { user, provider }] = await Promise.all([
    searchParams,
    requireProviderRow(),
  ]);
  const instagram =
    typeof provider.socialHandles === "object" && provider.socialHandles !== null
      ? ((provider.socialHandles as Record<string, string>).instagram ?? "")
      : "";

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Profile</h1>
      <p className="mt-2 text-ink-soft">
        What businesses see when you apply or match. Your profile is never public on the internet.
      </p>

      <form action={updateProfileAction} className="oc-card mt-8 space-y-5 p-6">
        <div>
          <label htmlFor="displayName" className="oc-label">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            required
            defaultValue={provider.displayName}
            className="oc-input"
          />
        </div>

        <div>
          <label htmlFor="bio" className="oc-label">
            Bio
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={4}
            defaultValue={provider.bio ?? ""}
            placeholder="Your specialties, experience, and what you're looking for."
            className="oc-input"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="homeCity" className="oc-label">
              Home city
            </label>
            <input id="homeCity" name="homeCity" defaultValue={provider.homeCity ?? ""} className="oc-input" />
          </div>
          <div>
            <label htmlFor="homeZip" className="oc-label">
              Home ZIP
            </label>
            <input
              id="homeZip"
              name="homeZip"
              inputMode="numeric"
              pattern="\d{5}"
              defaultValue={provider.homeZip ?? ""}
              placeholder="30309"
              className="oc-input"
            />
            <p className="mt-1 text-xs text-ink-soft">Georgia ZIPs for now.</p>
          </div>
          <div>
            <label htmlFor="travelRadiusMi" className="oc-label">
              Travel radius (mi)
            </label>
            <input
              id="travelRadiusMi"
              name="travelRadiusMi"
              type="number"
              min={1}
              max={300}
              defaultValue={provider.travelRadiusM ? Math.round(provider.travelRadiusM / 1609.34) : ""}
              className="oc-input"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="yearsExperience" className="oc-label">
              Years of experience
            </label>
            <input
              id="yearsExperience"
              name="yearsExperience"
              type="number"
              min={0}
              max={60}
              defaultValue={provider.yearsExperience ?? ""}
              className="oc-input"
            />
          </div>
          <div>
            <label htmlFor="instagram" className="oc-label">
              Instagram (optional)
            </label>
            <input
              id="instagram"
              name="instagram"
              defaultValue={instagram}
              placeholder="@yourhandle"
              className="oc-input"
            />
          </div>
        </div>

        <div>
          <span className="oc-label">Profile photo (optional)</span>
          <FileUpload
            bucket="avatars"
            userId={user.id}
            name="headshot"
            label={provider.headshotPath ? "Replace photo" : "Upload photo"}
            currentFileName={provider.headshotPath ? "Photo on file ✓" : null}
          />
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
          <input
            type="checkbox"
            name="hiddenFromSearch"
            defaultChecked={provider.hiddenFromSearch}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Hide me from business search.</span>{" "}
            <span className="text-ink-soft">
              Businesses can still see your profile when you apply to their opportunities.
            </span>
          </span>
        </label>

        {error ? <p className="oc-error">{error}</p> : null}
        {notice ? <p className="oc-notice">{notice}</p> : null}
        <button type="submit" className="oc-btn">
          Save profile
        </button>
      </form>
    </div>
  );
}
