import Image from "next/image";
import Link from "next/link";
import { brand } from "@/config/brand";

/**
 * Standalone shell (like the auth pages): the invite page handles signed-out
 * visitors itself with a `next`-preserving login redirect, which the (app)
 * layout would swallow.
 */
export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mx-auto mb-8">
        <Image
          src={brand.logo.wordmark}
          alt={brand.name}
          width={165}
          height={40}
          priority
          className="h-[40px] w-auto"
        />
      </Link>
      {children}
    </main>
  );
}
