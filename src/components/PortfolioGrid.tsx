"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Renders the provider's OWN private portfolio images via short-lived signed
 * URLs created under their JWT. (Businesses with a grant view portfolios
 * through the logged server-side signing path — Phase 7.)
 */
export function PortfolioGrid({
  items,
}: {
  items: Array<{ id: string; path: string; caption: string | null }>;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase.storage
        .from("portfolios")
        .createSignedUrls(items.map((item) => item.path), 600);
      if (cancelled || !data) return;
      const byPath: Record<string, string> = {};
      for (const entry of data) {
        if (entry.signedUrl && entry.path) byPath[entry.path] = entry.signedUrl;
      }
      setUrls(byPath);
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <figure key={item.id} className="oc-card overflow-hidden">
          {urls[item.path] ? (
            // Plain <img>: signed URLs are short-lived, so next/image's caching layer would break them.
            <img src={urls[item.path]} alt={item.caption ?? "Portfolio image"} className="aspect-square w-full object-cover" />
          ) : (
            <div className="aspect-square w-full animate-pulse bg-ink/5" />
          )}
          {item.caption ? (
            <figcaption className="px-3 py-2 text-xs text-ink-soft">{item.caption}</figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}
