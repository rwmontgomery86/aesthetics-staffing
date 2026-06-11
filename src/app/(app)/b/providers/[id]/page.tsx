import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  credentialDocuments,
  portfolioItems,
  profileAccessGrants,
  providerProfileTypes,
  providerProfiles,
  providerServices,
  providerTypes,
  services,
} from "@/db/schema";
import { GrantedPortfolioGrid } from "@/components/GrantedPortfolioGrid";
import { SignedFileLink } from "@/components/SignedFileLink";
import { SnapshotChips } from "@/components/SnapshotChips";
import { getCredentialSummary } from "@/lib/credentials/requirements";
import { requireActiveOrg } from "@/lib/org";

export const metadata = { title: "Provider profile" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Business view of a provider. Basics are visible to any business member
 * (RLS); credentials and portfolio appear only with an unrevoked
 * profile_access_grant — i.e. they applied to you, or granted you access.
 * Pay floors are NEVER selected here (privacy invariant).
 */
export default async function ProviderProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { contexts }] = await Promise.all([params, requireActiveOrg()]);
  if (!UUID.test(id)) notFound();

  const data = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const [provider] = await tx
      .select({
        id: providerProfiles.id,
        displayName: providerProfiles.displayName,
        bio: providerProfiles.bio,
        homeCity: providerProfiles.homeCity,
        homeState: providerProfiles.homeState,
        yearsExperience: providerProfiles.yearsExperience,
        urgentAvailable: providerProfiles.urgentAvailable,
        availableNowStatus: providerProfiles.availableNowStatus,
      })
      .from(providerProfiles)
      .where(eq(providerProfiles.id, id));
    if (!provider) return null;

    const [types, myServices, [grant]] = await Promise.all([
      tx
        .select({ name: providerTypes.name })
        .from(providerProfileTypes)
        .innerJoin(providerTypes, eq(providerTypes.id, providerProfileTypes.providerTypeId))
        .where(eq(providerProfileTypes.providerProfileId, id)),
      tx
        .select({ name: services.name })
        .from(providerServices)
        .innerJoin(services, eq(services.id, providerServices.serviceId))
        .where(eq(providerServices.providerProfileId, id)),
      tx
        .select({ id: profileAccessGrants.id })
        .from(profileAccessGrants)
        .where(
          and(eq(profileAccessGrants.providerProfileId, id), isNull(profileAccessGrants.revokedAt)),
        )
        .limit(1),
    ]);

    if (!grant) {
      return { provider, types, myServices, hasGrant: false as const };
    }

    const { chips, typeById } = await getCredentialSummary(tx, id, provider.homeState ?? "GA");
    const credentialIds = chips
      .map((chip) => chip.credentialId)
      .filter((value): value is string => Boolean(value));
    const documents = credentialIds.length
      ? await tx
          .select({
            id: credentialDocuments.id,
            providerCredentialId: credentialDocuments.providerCredentialId,
            fileName: credentialDocuments.fileName,
          })
          .from(credentialDocuments)
          .where(inArray(credentialDocuments.providerCredentialId, credentialIds))
      : [];
    const portfolio = await tx
      .select({ id: portfolioItems.id, caption: portfolioItems.caption })
      .from(portfolioItems)
      .where(eq(portfolioItems.providerProfileId, id))
      .orderBy(asc(portfolioItems.createdAt));

    return { provider, types, myServices, hasGrant: true as const, chips, typeById, documents, portfolio };
  });
  if (!data) notFound();
  const { provider, types, myServices } = data;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">{provider.displayName}</h1>
      <p className="mt-1 text-ink-soft">
        {types.map((t) => t.name).join(", ") || "Provider"}
        {provider.homeCity ? ` · ${provider.homeCity}, ${provider.homeState}` : ""}
        {provider.yearsExperience != null ? ` · ${provider.yearsExperience} yrs experience` : ""}
      </p>
      {provider.availableNowStatus ? (
        <p className="mt-2 inline-block rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
          Available {provider.availableNowStatus === "today" ? "today" : "this week"}
        </p>
      ) : null}

      {provider.bio ? (
        <section className="oc-card mt-6 p-6">
          <h2 className="text-lg font-semibold">About</h2>
          <p className="mt-2 whitespace-pre-line text-sm">{provider.bio}</p>
        </section>
      ) : null}

      <section className="oc-card mt-6 p-6">
        <h2 className="text-lg font-semibold">Services</h2>
        <p className="mt-2 text-sm">{myServices.map((s) => s.name).join(", ") || "—"}</p>
      </section>

      {data.hasGrant ? (
        <>
          <section className="oc-card mt-6 p-6">
            <h2 className="text-lg font-semibold">Credentials</h2>
            <p className="mt-1 text-xs text-ink-soft">
              Live status — document views are logged, and the provider can see who accessed what.
            </p>
            <div className="mt-3 space-y-3">
              {data.chips.length === 0 ? (
                <p className="text-sm text-ink-soft">No credentials on file.</p>
              ) : (
                data.chips.map((chip) => {
                  const type = data.typeById.get(chip.credentialTypeId);
                  const docs = data.documents.filter(
                    (doc) => doc.providerCredentialId === chip.credentialId,
                  );
                  return (
                    <div key={chip.credentialTypeId} className="text-sm">
                      <SnapshotChips
                        chips={[
                          {
                            credentialTypeId: chip.credentialTypeId,
                            name: type?.name ?? "Credential",
                            level: chip.level,
                            status: chip.status,
                            derived: chip.derived,
                            isWarning: chip.isWarning,
                          },
                        ]}
                      />
                      {docs.map((doc) => (
                        <p key={doc.id} className="mt-1 pl-1">
                          <SignedFileLink
                            kind="credential"
                            id={doc.id}
                            label={doc.fileName ?? "View document"}
                          />
                        </p>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="oc-card mt-6 p-6">
            <h2 className="text-lg font-semibold">Portfolio</h2>
            {data.portfolio.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">No portfolio items yet.</p>
            ) : (
              <div className="mt-3">
                <GrantedPortfolioGrid items={data.portfolio} />
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="oc-card mt-6 p-6 text-sm text-ink-soft">
          Credentials and portfolio unlock when this provider applies to one of your posts (or
          grants you access from their side).
        </section>
      )}
    </div>
  );
}
