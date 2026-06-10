"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client — used ONLY for Storage uploads (files go straight
 * from the browser to the bucket under the user's own JWT, so the owner-path
 * storage policies enforce isolation and big files never transit our server).
 * All DATA access stays server-side through dbAs().
 */
let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowser() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}
