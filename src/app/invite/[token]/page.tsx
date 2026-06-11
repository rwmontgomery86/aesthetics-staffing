import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { organizationInvites, organizations } from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";
import { hashInviteToken } from "@/lib/invite-token";
import { acceptInviteAction } from "./actions";

export const metadata = { title: "Team invite" };

const ROLE_LABELS: Record<string, string> = {
  owner: "an owner",
  admin: "an admin",
  poster: "a poster",
};

function StatusCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <div className="oc-card p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="mt-2 space-y-2 text-sm text-ink-soft">{children}</div>
      </div>
    </div>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getAuthUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const tokenHash = hashInviteToken(token);
  const [invite] = await dbAs({ id: user.id, email: user.email }, (tx) =>
    tx
      .select({
        id: organizationInvites.id,
        email: organizationInvites.email,
        role: organizationInvites.role,
        expiresAt: organizationInvites.expiresAt,
        acceptedByUserId: organizationInvites.acceptedByUserId,
        orgName: organizations.name,
      })
      .from(organizationInvites)
      .innerJoin(organizations, eq(organizations.id, organizationInvites.organizationId))
      .where(eq(organizationInvites.tokenHash, tokenHash)),
  );

  // RLS hides invites addressed to other emails, so "not found" usually means
  // "signed in with the wrong account" — say so.
  if (!invite) {
    return (
      <StatusCard title="This invite isn't for this account">
        <p>
          Team invites only work for the exact email address they were sent to
          {user.email ? (
            <>
              {" "}
              — you&apos;re signed in as <span className="font-medium text-ink">{user.email}</span>
            </>
          ) : null}
          .
        </p>
        <p>
          If the invite went to a different email, sign out and sign back in (or sign up) with
          that address, then open the link again. If you think the invite was revoked, ask the
          business to send a new one.
        </p>
      </StatusCard>
    );
  }

  // Org admins can see every invite for their org (that's how the team page
  // works), so visibility isn't enough — only the invited email may accept.
  // Without this, an admin opening a teammate's link would consume it.
  if (invite.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return (
      <StatusCard title="This invite is for someone else">
        <p>
          It was sent to <span className="font-medium text-ink">{invite.email}</span>, and only
          that email can use it. Forward them the link instead.
        </p>
      </StatusCard>
    );
  }

  if (invite.acceptedByUserId) {
    return (
      <StatusCard title="This invite was already used">
        {invite.acceptedByUserId === user.id ? (
          <>
            <p>You&apos;ve already joined {invite.orgName}.</p>
            <p>
              <Link href="/b" className="font-medium text-lilac">
                Go to the business dashboard →
              </Link>
            </p>
          </>
        ) : (
          <p>Each invite link works once. Ask {invite.orgName} to send a fresh one.</p>
        )}
      </StatusCard>
    );
  }

  if (invite.expiresAt < new Date()) {
    return (
      <StatusCard title="This invite has expired">
        <p>
          Invites are valid for 14 days. Ask {invite.orgName} to send a new one — it takes them a
          few seconds.
        </p>
      </StatusCard>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="oc-card p-6 text-center">
        <h1 className="text-2xl font-semibold">Join {invite.orgName}</h1>
        <p className="mt-3 text-ink-soft">
          You&apos;ve been invited to join <span className="font-medium text-ink">{invite.orgName}</span>{" "}
          as {ROLE_LABELS[invite.role]}.
        </p>
        <form action={acceptInviteAction} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="oc-btn w-full">
            Accept invite
          </button>
        </form>
        <p className="mt-3 text-xs text-ink-soft">
          Joining as {user.email} · You can leave the team at any time.
        </p>
      </div>
    </div>
  );
}
