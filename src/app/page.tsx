import Link from "next/link";
import { brand } from "@/config/brand";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-brass">Private preview</p>
      <h1 className="mt-3 text-5xl font-semibold leading-tight">{brand.name}</h1>
      <p className="mt-4 max-w-xl text-lg text-ink-soft">{brand.tagline}</p>
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
