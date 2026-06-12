import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";

const TABS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/credentials", label: "Credentials" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/organizations", label: "Businesses" },
  { href: "/admin/opportunities", label: "Posts" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/deliveries", label: "Deliveries" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/threads", label: "Threads" },
  { href: "/admin/audit", label: "Audit log" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div>
      <nav className="-mx-6 mb-8 overflow-x-auto border-b border-line px-6">
        <div className="flex gap-1 pb-px">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink"
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
