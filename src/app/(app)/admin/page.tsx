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
    </div>
  );
}
