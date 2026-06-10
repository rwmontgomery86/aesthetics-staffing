"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Opens one of the user's OWN private files via a short-lived signed URL
 * created under their JWT (owner-path storage RLS authorizes it). Business
 * and admin access to other people's files goes through the logged
 * server-side signing endpoint instead (Phases 7/9).
 */
export function PrivateFileLink({
  bucket,
  path,
  label = "View document",
}: {
  bucket: "credentials" | "portfolios";
  path: string;
  label?: string;
}) {
  const [error, setError] = useState("");

  async function open() {
    const { data, error: signError } = await getSupabaseBrowser()
      .storage.from(bucket)
      .createSignedUrl(path, 300);
    if (signError || !data?.signedUrl) {
      setError("Couldn't open the file — try again.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <span>
      <button type="button" onClick={open} className="text-sm underline hover:text-lilac">
        {label}
      </button>
      {error ? <span className="ml-2 text-sm text-danger">{error}</span> : null}
    </span>
  );
}
