import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";

export const metadata = { title: "Admin" };

export default async function AdminDashboard() {
  await requireAdmin();

  return (
    <div>
      <h1 className="text-3xl font-semibold">Platform admin</h1>
      <p className="mt-2 text-ink-soft">
        Credential review, users, organizations, and audit logs land here in Phase 9.
      </p>
      <Link href="/admin/threads" className="oc-card mt-6 block max-w-md p-4 hover:border-lilac">
        <p className="font-semibold">Message threads</p>
        <p className="text-sm text-ink-soft">
          Support review of conversations — flagged contact-pattern messages are marked. Every
          thread you open is logged to the audit trail.
        </p>
      </Link>
    </div>
  );
}
