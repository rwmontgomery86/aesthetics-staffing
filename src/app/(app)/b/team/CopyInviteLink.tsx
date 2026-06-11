"use client";

import { useState } from "react";

/** Shows the one-time invite link with a copy button (clipboard needs client JS). */
export function CopyInviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-ink/5 px-3 py-2 text-xs">
        {url}
      </code>
      <button
        type="button"
        className="oc-btn-secondary shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
