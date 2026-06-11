"use client";

import { useEffect, useRef, useState } from "react";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 25_000;

/**
 * The in-app bell: polls /api/notifications every ~25s (the schema's partial
 * unread index exists for exactly this query). Opening the menu marks
 * everything read. Polling, not realtime, is the locked MVP decision —
 * Supavisor drops LISTEN/NOTIFY.
 */
export function NotificationsBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; items: NotificationItem[] };
      setUnread(data.unread);
      setItems(data.items);
    } catch {
      // Polling failure is non-fatal; the next tick retries.
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      await fetch("/api/notifications", { method: "POST" }).catch(() => {});
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-lg hover:bg-ink/5"
      >
        🔔
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-card border border-line bg-surface p-2 shadow-card">
          <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-ink-soft">
            Notifications
          </p>
          {items.length === 0 ? (
            <p className="px-2 py-4 text-sm text-ink-soft">Nothing yet — alerts land here.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {items.map((item) => {
                const inner = (
                  <>
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="block whitespace-pre-line text-xs text-ink-soft">
                      {item.body.length > 160 ? `${item.body.slice(0, 160)}…` : item.body}
                    </span>
                  </>
                );
                return item.actionUrl ? (
                  <a
                    key={item.id}
                    href={item.actionUrl}
                    className="block rounded-lg px-2 py-2 hover:bg-ink/5"
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={item.id} className="rounded-lg px-2 py-2">
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
