import Image from "next/image";
import Link from "next/link";
import { brand } from "@/config/brand";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-lilac">Private preview</p>
      <Image
        src={brand.logo.main}
        alt={brand.name}
        width={260}
        height={260}
        priority
        className="-ml-6 mt-2"
      />
      <p className="max-w-xl text-lg text-ink-soft">{brand.tagline}</p>
      <p className="mt-2 max-w-xl text-ink-soft">
        Providers draw watch zones and get alerted the moment a matching shift, role, or event
        posts. Businesses fill open chairs without the phone tree.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/signup" className="oc-btn">
          Create an account
        </Link>
        <Link href="/login" className="oc-btn-secondary">
          Sign in
        </Link>
      </div>
    </main>
  );
}
