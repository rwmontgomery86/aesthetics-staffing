import Link from "next/link";

const TABS = [
  { href: "/p", label: "Dashboard" },
  { href: "/p/applications", label: "Applications" },
  { href: "/p/bookings", label: "Bookings" },
  { href: "/p/profile", label: "Profile" },
  { href: "/p/services", label: "Services" },
  { href: "/p/credentials", label: "Credentials" },
  { href: "/p/pay", label: "Pay" },
  { href: "/p/availability", label: "Availability" },
  { href: "/p/portfolio", label: "Portfolio" },
  { href: "/p/zones", label: "Watch zones" },
];

export default function ProviderLayout({ children }: { children: React.ReactNode }) {
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
