import Link from "next/link";
import { sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { requireAdmin } from "@/lib/auth/guards";
import { ts, type Ts } from "@/app/(app)/admin/format";

export const metadata = { title: "Credential review — admin" };

const VIEWS = [
  { key: "queue", label: "Review queue" },
  { key: "expiring", label: "Expiring ≤30d" },
  { key: "expired", label: "Expired" },
  { key: "all", label: "All" },
] as const;

const STATUS_CHIP: Record<string, string> = {
  not_provided: "bg-ink/5 text-ink-soft",
  self_attested: "bg-lilac/10 text-lilac",
  document_uploaded: "bg-blush/30 text-blush-deep",
  needs_review: "bg-blush/30 text-blush-deep",
  admin_reviewed: "bg-success/10 text-success",
  rejected_needs_info: "bg-danger/10 text-danger",
};

type Row = {
  id: string;
  status: string;
  state: string | null;
  expires_at: Ts | null;
  expired: boolean;
  submitted_for_review_at: Ts | null;
  created_at: Ts;
  type_name: string;
  provider_name: string;
  doc_count: number;
  risk_tier: number;
}

/**
 * USER_FLOWS §11: queue sorted by service risk tier (injectables/laser
 * first) then submission age. Risk tier of a credential type = max tier of
 * the service categories its requirement rows attach to (directly or via a
 * specific service); provider-type-only rows default to 1.
 */
export default async function AdminCredentialsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; notice?: string; error?: string }>;
}) {
  const [{ view: rawView, notice, error }, contexts] = await Promise.all([
    searchParams,
    requireAdmin(),
  ]);
  const view = VIEWS.some((v) => v.key === rawView) ? (rawView as string) : "queue";

  const where = {
    queue: sql`pc.status in ('document_uploaded', 'needs_review')`,
    expiring: sql`pc.expires_at between current_date and current_date + 30 and pc.status <> 'not_provided'`,
    expired: sql`pc.expires_at < current_date and pc.status <> 'not_provided'`,
    all: sql`true`,
  }[view as "queue" | "expiring" | "expired" | "all"];

  const rows = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) =>
    (
      await tx.execute<Row>(sql`
        select pc.id, pc.status, pc.state, pc.expires_at,
               (pc.expires_at < current_date) as expired,
               pc.submitted_for_review_at,
               pc.created_at, ct.name as type_name, pp.display_name as provider_name,
               (select count(*)::int from credential_documents cd
                 where cd.provider_credential_id = pc.id) as doc_count,
               coalesce((
                 select max(coalesce(sc.risk_tier, sc2.risk_tier, 1))::int
                 from credential_requirements cr
                 left join service_categories sc on sc.id = cr.service_category_id
                 left join services s on s.id = cr.service_id
                 left join service_categories sc2 on sc2.id = s.category_id
                 where cr.credential_type_id = pc.credential_type_id and cr.active
               ), 1) as risk_tier
        from provider_credentials pc
        join credential_types ct on ct.id = pc.credential_type_id
        join provider_profiles pp on pp.id = pc.provider_profile_id
        where ${where}
        order by risk_tier desc, coalesce(pc.submitted_for_review_at, pc.created_at) asc
        limit 200
      `)
    ).rows,
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold">Credential review</h1>
      <p className="mt-2 text-ink-soft">
        Highest-risk services first, oldest submissions next. Review is non-blocking — providers
        keep operating while items sit here.
      </p>
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}
      {error ? <p className="oc-error mt-4">{error}</p> : null}

      <div className="mt-6 flex gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/admin/credentials?view=${v.key}`}
            className={`rounded-full px-3 py-1 text-sm ${
              view === v.key ? "bg-ink text-paper" : "bg-ink/5 text-ink-soft hover:bg-ink/10"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="oc-card mt-6 p-6 text-center text-sm text-ink-soft">
          Nothing here right now.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((row) => {
            const expired = row.expired;
            return (
              <Link
                key={row.id}
                href={`/admin/credentials/${row.id}`}
                className="oc-card block p-4 hover:border-lilac"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{row.provider_name}</span>
                  <span className="text-sm text-ink-soft">
                    {row.type_name}
                    {row.state ? ` · ${row.state}` : ""}
                  </span>
                  {row.risk_tier >= 3 ? (
                    <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                      high risk
                    </span>
                  ) : row.risk_tier === 2 ? (
                    <span className="rounded-full bg-blush/30 px-2 py-0.5 text-xs font-medium text-blush-deep">
                      medium risk
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CHIP[row.status] ?? STATUS_CHIP.not_provided}`}
                  >
                    {row.status.replaceAll("_", " ")}
                  </span>
                  {row.expires_at ? (
                    <span className={expired ? "font-medium text-danger" : "text-ink-soft"}>
                      {expired ? "Expired" : "Expires"}{" "}
                      {ts(row.expires_at).toFormat("MMM d, yyyy")}
                    </span>
                  ) : null}
                  <span className="text-ink-soft">
                    {row.doc_count} document{row.doc_count === 1 ? "" : "s"} · submitted{" "}
                    {ts(row.submitted_for_review_at ?? row.created_at).toRelative()}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
