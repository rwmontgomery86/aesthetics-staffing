"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the (server-rendered) thread on an interval — polling, not
 *  realtime, is the locked MVP decision (Supavisor drops LISTEN/NOTIFY). */
export function AutoRefresh({ ms = 20_000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), ms);
    return () => clearInterval(timer);
  }, [router, ms]);
  return null;
}
