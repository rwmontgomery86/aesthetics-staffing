import Link from "next/link";
import { and, count, eq, gt, inArray, isNull } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  applications,
  bookingOccurrences,
  bookings,
  locations,
  opportunities,
  opportunityOccurrences,
  organizationInvites,
  organizationMembers,
  organizations,
} from "@/db/schema";
import { requireActiveOrg } from "@/lib/org";

export const metadata = { title: "Business dashboard" };

function ChecklistItem({
  done,
  href,
  title,
  detail,
}: {
  done: boolean;
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="oc-card flex items-center gap-4 p-4 transition-colors hover:border-lilac-soft"
    >
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          done ? "bg-success/15 text-success" : "bg-ink/5 text-ink-soft"
        }`}
      >
        {done ? "✓" : "·"}
      </span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-ink-soft">{detail}</span>
      </span>
    </Link>
  );
}

export default async function BusinessDashboard({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const [{ notice }, { contexts, org }] = await Promise.all([searchParams, requireActiveOrg()]);

  const data = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const [orgRow] = await tx.select().from(organizations).where(eq(organizations.id, org.id));
    const [locationCount] = await tx
      .select({ value: count() })
      .from(locations)
      .where(eq(locations.organizationId, org.id));
    const [memberCount] = await tx
      .select({ value: count() })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, org.id));
    const [pendingInvites] = await tx
      .select({ value: count() })
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.organizationId, org.id),
          isNull(organizationInvites.acceptedByUserId),
          gt(organizationInvites.expiresAt, new Date()),
        ),
      );
    const [opportunityCount] = await tx
      .select({ value: count() })
      .from(opportunities)
      .where(eq(opportunities.organizationId, org.id));
    const [pendingApplications] = await tx
      .select({ value: count() })
      .from(applications)
      .innerJoin(opportunities, eq(opportunities.id, applications.opportunityId))
      .where(
        and(
          eq(opportunities.organizationId, org.id),
          inArray(applications.status, ["submitted", "viewed", "shortlisted"]),
        ),
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
          eq(bookings.organizationId, org.id),
          eq(bookingOccurrences.status, "confirmed"),
          gt(opportunityOccurrences.startsAt, new Date()),
        ),
      );
    return {
      orgRow,
      locations: locationCount.value,
      members: memberCount.value,
      pendingInvites: pendingInvites.value,
      opportunities: opportunityCount.value,
      pendingApplications: pendingApplications.value,
      upcomingDates: upcomingDates.value,
    };
  });

  const profileDone = Boolean(data.orgRow?.description);
  const teamDone = data.members > 1 || data.pendingInvites > 0;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">{org.name}</h1>
      <p className="mt-2 text-ink-soft">
        Your business dashboard — you&apos;re{" "}
        {org.role === "owner" ? "the owner" : org.role === "admin" ? "an admin" : "a poster"}.
      </p>
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      {data.pendingApplications > 0 || data.upcomingDates > 0 ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href="/b/opportunities" className="oc-card p-4 hover:border-lilac">
            <p className="text-2xl font-semibold">{data.pendingApplications}</p>
            <p className="text-sm text-ink-soft">Applications to review</p>
          </Link>
          <Link href="/b/bookings" className="oc-card p-4 hover:border-lilac">
            <p className="text-2xl font-semibold">{data.upcomingDates}</p>
            <p className="text-sm text-ink-soft">Upcoming booked dates</p>
          </Link>
        </div>
      ) : null}

      <Link href="/b/messages" className="oc-card mt-3 block p-4 hover:border-lilac">
        <p className="font-semibold">Messages</p>
        <p className="text-sm text-ink-soft">
          Conversations with applicants and booked providers.
        </p>
      </Link>

      <div className="mt-8 space-y-3">
        <ChecklistItem
          done={profileDone}
          href="/b/profile"
          title="Business profile"
          detail={
            profileDone
              ? "Providers see this when your opportunities match."
              : "Describe your business — providers see this on every alert."
          }
        />
        <ChecklistItem
          done={data.locations > 0}
          href="/b/locations"
          title="Locations"
          detail={
            data.locations > 0
              ? `${data.locations} location${data.locations > 1 ? "s" : ""} — each gets its own map pin.`
              : "Add the places providers will work — each gets its own map pin."
          }
        />
        <ChecklistItem
          done={teamDone}
          href="/b/team"
          title="Team"
          detail={
            teamDone
              ? `${data.members} member${data.members > 1 ? "s" : ""}${
                  data.pendingInvites > 0 ? `, ${data.pendingInvites} invite pending` : ""
                }`
              : "Invite teammates who can post opportunities or manage the account."
          }
        />
        <ChecklistItem
          done={data.opportunities > 0}
          href="/b/opportunities"
          title="Post an opportunity"
          detail={
            data.opportunities > 0
              ? `${data.opportunities} opportunit${data.opportunities > 1 ? "ies" : "y"} — matching providers are alerted the moment you post.`
              : "Shifts, roles, and events — matching providers get alerted instantly."
          }
        />
      </div>
    </div>
  );
}
