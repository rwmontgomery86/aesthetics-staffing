"use client";

import { useEffect, useState } from "react";

/**
 * Portfolio images for a business holding a grant: every image URL comes from
 * the logged signing endpoint, so each render writes document_access_logs
 * rows (the privacy invariant: all third-party file access is logged).
 */
export function GrantedPortfolioGrid({
  items,
}: {
  items: Array<{ id: string; caption: string | null }>;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        items.map(async (item) => {
          try {
            const res = await fetch("/api/files/sign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: "portfolio", id: item.id }),
            });
            const data = (await res.json()) as { url?: string };
            return [item.id, res.ok && data.url ? data.url : null] as const;
          } catch {
            return [item.id, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const byId: Record<string, string> = {};
      let anyFailed = false;
      for (const [id, url] of results) {
        if (url) byId[id] = url;
        else anyFailed = true;
      }
      setUrls(byId);
      setFailed(anyFailed);
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div>
      {failed ? (
        <p className="mb-2 text-sm text-ink-soft">Some images couldn&apos;t load — try refreshing.</p>
      ) : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {items.map((item) => (
          <figure key={item.id}>
            {urls[item.id] ? (
              // Short-lived signed URL from a private bucket — next/image's
              // cache would outlive it; a plain <img> is correct here.
              <img
                src={urls[item.id]}
                alt={item.caption ?? ""}
                className="aspect-square w-full rounded-xl border border-line object-cover"
              />
            ) : (
              <div className="aspect-square w-full animate-pulse rounded-xl bg-ink/5" />
            )}
            {item.caption ? (
              <figcaption className="mt-1 text-xs text-ink-soft">{item.caption}</figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </div>
  );
}
