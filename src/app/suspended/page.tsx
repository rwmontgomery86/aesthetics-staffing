import Image from "next/image";
import { redirect } from "next/navigation";
import { brand } from "@/config/brand";
import { getUserContexts } from "@/lib/auth/session";
import { signOutAction } from "@/app/(auth)/actions";

export const metadata = { title: "Account suspended" };

/** Outside the (app) layout on purpose — the suspension gate redirects here. */
export default async function SuspendedPage() {
  const contexts = await getUserContexts();
  if (!contexts) redirect("/login");
  if (!contexts.suspendedAt) redirect("/me");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <Image src={brand.logo.wordmark} alt={brand.name} width={124} height={30} />
      <h1 className="mt-8 text-2xl font-semibold">This account is suspended</h1>
      <p className="mt-3 text-ink-soft">
        {`Your account was suspended by the ${brand.name} team and can't be used right now. If you believe this is a mistake, reply to any email we've sent you and we'll take another look.`}
      </p>
      <form action={signOutAction} className="mt-8">
        <button type="submit" className="oc-btn-secondary">
          Sign out
        </button>
      </form>
    </main>
  );
}
