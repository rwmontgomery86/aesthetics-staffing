import Link from "next/link";
import { and, count, eq, gt, inArray } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  applications,
  bookingOccurrences,
  bookings,
  opportunityOccurrences,
  portfolioItems,
  providerAvailability,
  providerServices,
  watchZones,
} from "@/db/schema";
import { getCredentialSummary } from "@/lib/credentials/requirements";
import { requireProviderRow } from "@/lib/provider";

export const metadata = { title: "Provider dashboard" };

function ChecklistItem({
  done,
  href,
  title,
  detail,
  warning,
}: {
  done: boolean;
  href: string;
  title: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`oc-card flex items-center gap-4 p-4 transition-colors hover:border-lilac-soft ${
        warning ? "border-danger/40" : ""
      }`}
    >
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          done ? "bg-success/15 text-success" : warning ? "bg-danger/10 text-danger" : "bg-ink/5 text-ink-soft"
        }`}
      >
        {done ? "✓" : warning ? "!" : "·"}
      </span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-ink-soft">{detail}</span>
      </span>
    </Link>
  );
}

export default async function ProviderDashboard() {
  const { user, provider } = await requireProviderRow();

  const data = await dbAs(user, async (tx) => {
    const [serviceCount] = await tx
      .select({ value: count() })
      .from(providerServices)
      .where(eq(providerServices.providerProfileId, provider.id));
    const [zoneCount] = await tx
      .select({ value: count() })
      .from(watchZones)
      .where(eq(watchZones.providerProfileId, provider.id));
    const [availabilityCount] = await tx
      .select({ value: count() })
      .from(providerAvailability)
      .where(eq(providerAvailability.providerProfileId, provider.id));
    const [portfolioCount] = await tx
      .select({ value: count() })
      .from(portfolioItems)
      .where(eq(portfolioItems.providerProfileId, provider.id));
    const { chips } = await getCredentialSummary(tx, provider.id, "GA");
    const [activeApplications] = await tx
      .select({ value: count() })
      .from(applications)
      .where(
        and(
          eq(applications.providerProfileId, provider.id),
          inArray(applications.status, ["submitted", "viewed", "shortlisted"]),
        ),
      );
    const [offers] = await tx
      .select({ value: count() })
      .from(applications)
      .where(
        and(eq(applications.providerProfileId, provider.id), eq(applications.status, "offered")),
      );
    const [upcomingDates] = await tx
      .select({ value: count() })
      .from(bookingOccurrences)
      .innerJoin(bookings, eq(bookings.id, bookingOccurrences.bookingId))
      .innerJoin(
        opportunityOccurrences,
        eq(opportunityOccurrences.id, bookingOccurrences.occurrenceId),
      )
      .where(
        and(
          eq(bookings.providerProfileId, provider.id),
          eq(bookingOccurrences.status, "confirmed"),
          gt(opportunityOccurrences.startsAt, new Date()),
        ),
      );
    return {
      services: serviceCount.value,
      zones: zoneCount.value,
      availability: availabilityCount.value,
      portfolio: portfolioCount.value,
      credentialWarnings: chips.filter((chip) => chip.isWarning).length,
      requiredCredentials: chips.filter((chip) => chip.level === "required").length,
      activeApplications: activeApplications.value,
      offers: offers.value,
      upcomingDates: upcomingDates.value,
    };
  });

  const profileDone = Boolean(provider.homeZip);
  const payDone = provider.payMinCents != null || (provider.payStructuresAccepted?.length ?? 0) > 0;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Welcome, {provider.displayName}</h1>
      <p className="mt-2 text-ink-soft">
        {data.zones > 0
          ? "You're set up for alerts — matching opportunities hit your bell, email, and texts the moment they post."
          : "Finish the steps below and you'll be alerted the moment matching work posts."}
      </p>

      {data.offers > 0 ? (
        <Link href="/p/applications" className="oc-card mt-6 block border-success/40 p-4 hover:border-success">
          <p className="font-medium text-success">
            🎉 You&apos;ve been selected — {data.offers} offer{data.offers > 1 ? "s" : ""} waiting
          </p>
          <p className="mt-1 text-sm text-ink-soft">Review the terms and confirm to lock in the booking.</p>
        </Link>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/p/applications" className="oc-card p-4 hover:border-lilac">
          <p className="text-2xl font-semibold">{data.activeApplications + data.offers}</p>
          <p className="text-sm text-ink-soft">Active applications</p>
        </Link>
        <Link href="/p/bookings" className="oc-card p-4 hover:border-lilac">
          <p className="text-2xl font-semibold">{data.upcomingDates}</p>
          <p className="text-sm text-ink-soft">Upcoming booked dates</p>
        </Link>
      </div>

      <div className="mt-8 space-y-3">
        <ChecklistItem
          done={profileDone}
          href="/p/profile"
          title="Profile basics"
          detail={profileDone ? `Home base: ${provider.homeCity ?? ""} ${provider.homeZip}` : "Add your home ZIP so distance works."}
        />
        <ChecklistItem
          done={data.services > 0}
          href="/p/services"
          title="Categories & services"
          detail={data.services > 0 ? `${data.services} services selected` : "Pick what you offer — this drives matching."}
        />
        <ChecklistItem
          done={data.requiredCredentials > 0 && data.credentialWarnings === 0}
          warning={data.credentialWarnings > 0}
          href="/p/credentials"
          title="Credentials"
          detail={
            data.credentialWarnings > 0
              ? `${data.credentialWarnings} required credential${data.credentialWarnings > 1 ? "s" : ""} missing or expired — businesses see this too`
              : data.requiredCredentials > 0
                ? "All required credentials provided"
                : "Pick services first, then add the credentials they call for."
          }
        />
        <ChecklistItem
          done={payDone}
          href="/p/pay"
          title="Pay preferences"
          detail={payDone ? "Pay floor and structures set" : "Set your private minimum so alerts respect it."}
        />
        <ChecklistItem
          done={data.availability > 0}
          href="/p/availability"
          title="Availability (optional)"
          detail={data.availability > 0 ? `${data.availability} time blocks` : "Helps grade matches as exact vs close."}
        />
        <ChecklistItem
          done={data.zones > 0}
          href="/p/zones"
          title="Watch zones"
          detail={data.zones > 0 ? `${data.zones} zone${data.zones > 1 ? "s" : ""} active` : "No zones, no alerts — create your first."}
        />
        <ChecklistItem
          done={data.portfolio > 0}
          href="/p/portfolio"
          title="Portfolio (optional)"
          detail={
            data.portfolio > 0
              ? `${data.portfolio} image${data.portfolio > 1 ? "s" : ""} — visible only to businesses you approve`
              : "Before/after work, shared only with businesses you apply to."
          }
        />
      </div>
    </div>
  );
}
