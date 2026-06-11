"use client";

import { useState } from "react";

/**
 * Opens SOMEONE ELSE'S private file through the logged server signing
 * endpoint (/api/files/sign): grant-checked by RLS, every view writes a
 * document_access_logs row. Counterpart to PrivateFileLink (owner's own files).
 */
export function SignedFileLink({
  kind,
  id,
  label = "View document",
}: {
  kind: "credential" | "portfolio";
  id: string;
  label?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/files/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Couldn't open the file — try again.");
        return;
      }
      window.open(data.url, "_blank", "noopener");
    } catch {
      setError("Couldn't open the file — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="text-sm underline hover:text-lilac disabled:opacity-50"
      >
        {label}
      </button>
      {error ? <span className="ml-2 text-sm text-danger">{error}</span> : null}
    </span>
  );
}
