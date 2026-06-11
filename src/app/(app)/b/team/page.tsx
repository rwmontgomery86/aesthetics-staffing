import { and, asc, eq, isNull } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { organizationInvites, organizationMembers, profiles } from "@/db/schema";
import { requireActiveOrg } from "@/lib/org";
import { roleAtLeast } from "@/lib/auth/guards";
import { CopyInviteLink } from "./CopyInviteLink";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
} from "./actions";

export const metadata = { title: "Team" };

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  poster: "Poster",
};

const ROLE_HELP =
  "Owners control everything including ownership itself. Admins manage the profile, locations, and team. Posters can post opportunities and message applicants, but can't change the team.";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; invite?: string }>;
}) {
  const [{ error, notice, invite }, { contexts, org }] = await Promise.all([
    searchParams,
    requireActiveOrg(),
  ]);
  const canManage = roleAtLeast(org.role, "admin");
  const isOwner = org.role === "owner";

  const data = await dbAs({ id: contexts.user.id, email: contexts.user.email }, async (tx) => {
    const members = await tx
      .select({
        userId: organizationMembers.userId,
        role: organizationMembers.role,
        title: organizationMembers.title,
        createdAt: organizationMembers.createdAt,
        fullName: profiles.fullName,
      })
      .from(organizationMembers)
      .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, org.id))
      .orderBy(asc(organizationMembers.createdAt));
    const invites = canManage
      ? await tx
          .select()
          .from(organizationInvites)
          .where(
            and(
              eq(organizationInvites.organizationId, org.id),
              isNull(organizationInvites.acceptedByUserId),
            ),
          )
          .orderBy(asc(organizationInvites.createdAt))
      : [];
    return { members, invites };
  });

  const ownerTotal = data.members.filter((m) => m.role === "owner").length;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Team</h1>
      <p className="mt-2 text-ink-soft">{ROLE_HELP}</p>

      {error ? <p className="oc-error mt-4">{error}</p> : null}
      {notice ? <p className="oc-notice mt-4">{notice}</p> : null}

      {invite ? (
        <div className="oc-card mt-6 space-y-2 border-lilac-soft p-4">
          <p className="text-sm font-medium">
            Invite created — send this link to your teammate. It works once, only for the email
            you invited, and expires in 14 days.
          </p>
          <CopyInviteLink
            url={`${process.env.APP_BASE_URL ?? "http://localhost:4000"}/invite/${invite}`}
          />
          <p className="text-xs text-ink-soft">
            Copy it now — for security we don&apos;t store the link, so it won&apos;t be shown
            again. (Automatic invite emails arrive in a later phase.)
          </p>
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Members</h2>
        <div className="mt-3 space-y-3">
          {data.members.map((member) => {
            const isSelf = member.userId === contexts.user.id;
            // Role/removal controls follow the action guards: owner rows are
            // owner-only territory; everyone gets a "leave" button on their own
            // row (disabled for the last owner).
            const showRoleControls = canManage && !isSelf && (member.role !== "owner" || isOwner);
            const showRemove =
              (canManage && !isSelf && (member.role !== "owner" || isOwner)) || isSelf;
            const lastOwnerLock = member.role === "owner" && ownerTotal <= 1;

            return (
              <div key={member.userId} className="oc-card flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {member.fullName || "Pending name"}
                    {isSelf ? <span className="text-ink-soft"> (you)</span> : null}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {ROLE_LABELS[member.role]}
                    {member.title ? ` · ${member.title}` : ""}
                  </p>
                </div>

                {showRoleControls ? (
                  <form action={changeMemberRoleAction} className="flex items-center gap-2">
                    <input type="hidden" name="organizationId" value={org.id} />
                    <input type="hidden" name="userId" value={member.userId} />
                    <select
                      name="role"
                      defaultValue={member.role}
                      className="oc-input w-auto py-1.5 text-sm"
                      aria-label={`Role for ${member.fullName}`}
                    >
                      {isOwner ? <option value="owner">Owner</option> : null}
                      <option value="admin">Admin</option>
                      <option value="poster">Poster</option>
                    </select>
                    <button type="submit" className="oc-btn-secondary text-sm">
                      Update
                    </button>
                  </form>
                ) : null}

                {showRemove ? (
                  lastOwnerLock && isSelf ? (
                    <p className="text-xs text-ink-soft">
                      Promote another owner before leaving.
                    </p>
                  ) : (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="organizationId" value={org.id} />
                      <input type="hidden" name="userId" value={member.userId} />
                      <button type="submit" className="oc-btn-ghost text-sm text-danger">
                        {isSelf ? "Leave business" : "Remove"}
                      </button>
                    </form>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {canManage ? (
        <>
          <section className="mt-10">
            <h2 className="text-xl font-semibold">Invite a teammate</h2>
            <form action={inviteMemberAction} className="oc-card mt-3 space-y-4 p-6">
              <input type="hidden" name="organizationId" value={org.id} />
              <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <div>
                  <label htmlFor="email" className="oc-label">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder="teammate@business.com"
                    className="oc-input"
                  />
                </div>
                <div>
                  <label htmlFor="role" className="oc-label">
                    Role
                  </label>
                  <select id="role" name="role" defaultValue="poster" className="oc-input">
                    <option value="poster">Poster</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button type="submit" className="oc-btn">
                  Create invite
                </button>
              </div>
              <p className="text-xs text-ink-soft">
                You&apos;ll get a link to send them. They sign in (or sign up) with this exact
                email to join. Owners are promoted from the member list after joining.
              </p>
            </form>
          </section>

          {data.invites.length > 0 ? (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">Pending invites</h2>
              <div className="mt-3 space-y-3">
                {data.invites.map((inv) => {
                  const expired = inv.expiresAt < new Date();
                  return (
                    <div key={inv.id} className="oc-card flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{inv.email}</p>
                        <p className="text-sm text-ink-soft">
                          {ROLE_LABELS[inv.role]} ·{" "}
                          {expired
                            ? "expired — revoke and re-invite"
                            : `expires ${inv.expiresAt.toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}`}
                        </p>
                      </div>
                      <form action={revokeInviteAction}>
                        <input type="hidden" name="organizationId" value={org.id} />
                        <input type="hidden" name="inviteId" value={inv.id} />
                        <button type="submit" className="oc-btn-ghost text-sm text-danger">
                          Revoke
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
