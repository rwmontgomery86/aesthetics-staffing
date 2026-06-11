import Image from "next/image";
import Link from "next/link";
import { brand } from "@/config/brand";

/** Public page shell — no auth, no app chrome (the invite-layout pattern). */
export default function PublicOpportunityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link href="/">
            <Image
              src={brand.logo.wordmark}
              alt={brand.name}
              width={124}
              height={30}
              priority
              className="h-[30px] w-auto"
            />
          </Link>
          <Link href="/signup" className="oc-btn-secondary">
            Join as a provider
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
