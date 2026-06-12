import Link from "next/link";
import { sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guards";

export const metadata = { title: "Admin" };

export default async function AdminDashboard() {
  const contexts = await requireAdmin();

  const [counts] = await dbAs(
    { id: contexts.user.id, email: contexts.user.email },
    async (tx) =>
      (
        await tx.execute<{
          review_queue: number;
          expiring_30d: number;
          expired: number;
          flagged_messages: number;
          disputed_completions: number;
          open_no_shows: number;
          suspended_users: number;
        }>(sql`
          select
            (select count(*) from provider_credentials
              where status in ('document_uploaded', 'needs_review'))::int as review_queue,
            (select count(*) from provider_credentials
              where expires_at between current_date and current_date + 30
                and status not in ('not_provided'))::int as expiring_30d,
            (select count(*) from provider_credentials
              where expires_at < current_date
                and status not in ('not_provided'))::int as expired,
            (select count(*) from messages where contact_flagged)::int as flagged_messages,
            (select count(*) from completion_records where status = 'disputed')::int as disputed_completions,
            (select count(*) from booking_occurrences
              where no_show_reported_by_user_id is not null
                and status in ('no_show_provider', 'no_show_business', 'disputed'))::int as open_no_shows,
            (select count(*) from profiles where suspended_at is not null)::int as suspended_users
        `)
      ).rows,
  );

  const cards = [
    { href: "/admin/credentials", label: "Credentials awaiting review", value: counts.review_queue },
    { href: "/admin/credentials?view=expiring", label: "Expiring within 30 days", value: counts.expiring_30d },
    { href: "/admin/credentials?view=expired", label: "Expired credentials", value: counts.expired },
    { href: "/admin/reports", label: "Flagged messages", value: counts.flagged_messages },
    { href: "/admin/reports", label: "Disputed completions", value: counts.disputed_completions },
    { href: "/admin/reports", label: "No-show reports", value: counts.open_no_shows },
    { href: "/admin/users?filter=suspended", label: "Suspended accounts", value: counts.suspended_users },
  ];

  return (
    <div>
      <h1 className="text-3xl font-semibold">Platform admin</h1>
      <p className="mt-2 text-ink-soft">
        Every action taken here is written to the audit log.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.label} href={card.href} className="oc-card p-4 hover:border-lilac">
            <p className="text-2xl font-semibold">{card.value}</p>
            <p className="text-sm text-ink-soft">{card.label}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
