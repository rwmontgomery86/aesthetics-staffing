import { requireProviderRow } from "@/lib/provider";
import { updatePayAction } from "./actions";

export const metadata = { title: "Pay preferences" };

const STRUCTURES: Array<{ value: string; label: string }> = [
  { value: "hour", label: "Hourly" },
  { value: "day", label: "Day rate" },
  { value: "per_treatment", label: "Per treatment" },
  { value: "commission_pct", label: "Commission" },
  { value: "salary_year", label: "Salary" },
  { value: "flat", label: "Flat / event rate" },
];

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const [{ error, notice }, { provider }] = await Promise.all([searchParams, requireProviderRow()]);
  const accepted = new Set(provider.payStructuresAccepted ?? []);

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Pay preferences</h1>
      <p className="mt-2 text-ink-soft">
        Your minimum is private — businesses never see it, and other providers never see yours.
        It only filters which alerts you receive.
      </p>

      <form action={updatePayAction} className="oc-card mt-8 space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="payMin" className="oc-label">
              Minimum pay (optional)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-ink-soft">$</span>
              <input
                id="payMin"
                name="payMin"
                type="number"
                min={0}
                step="0.01"
                defaultValue={provider.payMinCents != null ? provider.payMinCents / 100 : ""}
                className="oc-input"
              />
            </div>
          </div>
          <div>
            <label htmlFor="payMinUnit" className="oc-label">
              Per
            </label>
            <select
              id="payMinUnit"
              name="payMinUnit"
              defaultValue={provider.payMinUnit ?? "hour"}
              className="oc-input"
            >
              {STRUCTURES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className="oc-label">Pay structures I&apos;ll consider</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {STRUCTURES.map((s) => (
              <label
                key={s.value}
                className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:border-lilac-soft"
              >
                <input
                  type="checkbox"
                  name="structure"
                  value={s.value}
                  defaultChecked={accepted.has(s.value as never)}
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
          <input type="checkbox" name="urgentAvailable" defaultChecked={provider.urgentAvailable} className="mt-0.5" />
          <span>
            <span className="font-medium">Available for urgent, same-day coverage.</span>{" "}
            <span className="text-ink-soft">Urgent alerts can also reach you by text (Phase 6).</span>
          </span>
        </label>

        <div>
          <label htmlFor="availableNow" className="oc-label">
            Open-to-work status
          </label>
          <select
            id="availableNow"
            name="availableNow"
            defaultValue={provider.availableNowStatus ?? ""}
            className="oc-input"
          >
            <option value="">No status</option>
            <option value="today">Available today</option>
            <option value="this_week">Available this week</option>
          </select>
        </div>

        {error ? <p className="oc-error">{error}</p> : null}
        {notice ? <p className="oc-notice">{notice}</p> : null}
        <button type="submit" className="oc-btn">
          Save pay preferences
        </button>
      </form>
    </div>
  );
}
