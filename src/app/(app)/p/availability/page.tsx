import { asc, eq } from "drizzle-orm";
import { dbAs } from "@/db/client";
import { providerAvailability } from "@/db/schema";
import { requireProviderRow } from "@/lib/provider";
import { addAvailabilityAction, removeAvailabilityAction } from "./actions";

export const metadata = { title: "Availability" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime(value: string): string {
  const [hourString, minute] = value.split(":");
  const hour = Number(hourString);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, { user, provider }] = await Promise.all([searchParams, requireProviderRow()]);
  const rows = await dbAs(user, (tx) =>
    tx
      .select()
      .from(providerAvailability)
      .where(eq(providerAvailability.providerProfileId, provider.id))
      .orderBy(asc(providerAvailability.dayOfWeek), asc(providerAvailability.timeStart)),
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Weekly availability</h1>
      <p className="mt-2 text-ink-soft">
        A rough weekly pattern is enough — it helps grade matches as exact or close. You can always
        apply to anything regardless.
      </p>

      <div className="oc-card mt-8 p-6">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No availability set yet — matching treats your schedule as open.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between py-3">
                <span className="text-sm">
                  <span className="font-medium">{DAYS[row.dayOfWeek]}</span>{" "}
                  <span className="text-ink-soft">
                    {formatTime(row.timeStart)} – {formatTime(row.timeEnd)}
                  </span>
                </span>
                <form action={removeAvailabilityAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <button type="submit" className="oc-btn-ghost text-danger">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form action={addAvailabilityAction} className="oc-card mt-6 flex flex-wrap items-end gap-3 p-6">
        <div>
          <label htmlFor="dayOfWeek" className="oc-label">
            Day
          </label>
          <select id="dayOfWeek" name="dayOfWeek" className="oc-input">
            {DAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="timeStart" className="oc-label">
            From
          </label>
          <input id="timeStart" name="timeStart" type="time" required defaultValue="09:00" className="oc-input" />
        </div>
        <div>
          <label htmlFor="timeEnd" className="oc-label">
            Until
          </label>
          <input id="timeEnd" name="timeEnd" type="time" required defaultValue="17:00" className="oc-input" />
        </div>
        <button type="submit" className="oc-btn">
          Add
        </button>
        {error ? <p className="oc-error w-full">{error}</p> : null}
      </form>
    </div>
  );
}
