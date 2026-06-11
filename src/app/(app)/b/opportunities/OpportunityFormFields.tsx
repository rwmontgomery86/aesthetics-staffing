import { DateTime } from "luxon";
import type { opportunities } from "@/db/schema";
import type { OpportunityTypeMeta } from "@/lib/opportunity-types";
import { parseWeeklyRRule } from "@/lib/recurrence";

type OpportunityRow = typeof opportunities.$inferSelect;

export interface TaxonomyData {
  providerTypes: { id: string; name: string }[];
  categories: { id: string; name: string; riskTier: number }[];
  services: { id: string; name: string; categoryId: string }[];
  locations: { id: string; name: string; city: string; active: boolean }[];
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toLocalInput(value: Date | null, timezone: string): string {
  if (!value) return "";
  return DateTime.fromJSDate(value, { zone: timezone }).toFormat("yyyy-MM-dd'T'HH:mm");
}

/**
 * Shared create/edit field set. Server component — schedule and pay sections
 * are decided by the TYPE (fixed per form), so no client JS is needed.
 */
export function OpportunityFormFields({
  meta,
  taxonomy,
  opportunity,
  selectedServiceIds,
  selectedProviderTypeIds,
  occurrenceDefaults,
}: {
  meta: OpportunityTypeMeta;
  taxonomy: TaxonomyData;
  opportunity?: OpportunityRow;
  selectedServiceIds?: Set<string>;
  selectedProviderTypeIds?: Set<string>;
  /** For one-time edits: the current occurrence's local date/times. */
  occurrenceDefaults?: { date: string; startTime: string; endTime: string };
}) {
  const tz = opportunity?.timezone ?? "America/New_York";
  const weekly = opportunity?.recurrenceRule ? parseWeeklyRRule(opportunity.recurrenceRule) : null;
  const recurringEnd =
    weekly && opportunity?.recurrenceLocalStart && opportunity.recurrenceDurationMin != null
      ? DateTime.fromISO(`2026-01-05T${opportunity.recurrenceLocalStart.slice(0, 5)}`)
          .plus({ minutes: opportunity.recurrenceDurationMin })
          .toFormat("HH:mm")
      : "";
  const hasHighRisk = taxonomy.categories.some((c) => c.riskTier >= 3);

  return (
    <>
      <section className="oc-card space-y-4 p-6">
        <h2 className="text-lg font-semibold">Basics</h2>
        <div>
          <label htmlFor="title" className="oc-label">
            Title
          </label>
          <input
            id="title"
            name="title"
            required
            minLength={4}
            defaultValue={opportunity?.title ?? ""}
            placeholder="e.g. Injector coverage — Saturday"
            className="oc-input"
          />
        </div>
        <div>
          <label htmlFor="locationId" className="oc-label">
            Location
          </label>
          <select id="locationId" name="locationId" required defaultValue={opportunity?.locationId ?? ""} className="oc-input">
            <option value="" disabled>
              Pick a location…
            </option>
            {taxonomy.locations.map((loc) => (
              <option key={loc.id} value={loc.id} disabled={!loc.active}>
                {loc.name} — {loc.city}
                {loc.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="description" className="oc-label">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={opportunity?.description ?? ""}
            placeholder="What the day looks like, who your clientele is, what great looks like."
            className="oc-input"
          />
        </div>
      </section>

      <section className="oc-card space-y-4 p-6">
        <h2 className="text-lg font-semibold">Who you need</h2>
        <div>
          <span className="oc-label">Provider type(s)</span>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {taxonomy.providerTypes.map((pt) => (
              <label key={pt.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-sm hover:border-lilac-soft">
                <input
                  type="checkbox"
                  name="providerTypeIds"
                  value={pt.id}
                  defaultChecked={selectedProviderTypeIds?.has(pt.id) ?? false}
                />
                {pt.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <span className="oc-label">Services needed</span>
          {taxonomy.categories.map((category) => {
            const categoryServices = taxonomy.services.filter((s) => s.categoryId === category.id);
            if (categoryServices.length === 0) return null;
            return (
              <div key={category.id} className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  {category.name}
                  {category.riskTier >= 3 ? " · supervision attestation required" : ""}
                </h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {categoryServices.map((service) => (
                    <label
                      key={service.id}
                      className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:border-lilac-soft"
                    >
                      <input
                        type="checkbox"
                        name="serviceIds"
                        value={service.id}
                        defaultChecked={selectedServiceIds?.has(service.id) ?? false}
                      />
                      {service.name}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {meta.schedule === "one_time" ? (
        <section className="oc-card space-y-4 p-6">
          <h2 className="text-lg font-semibold">Schedule</h2>
          <p className="text-sm text-ink-soft">Times are in the location&apos;s timezone.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="date" className="oc-label">
                Date
              </label>
              <input id="date" name="date" type="date" required defaultValue={occurrenceDefaults?.date ?? ""} className="oc-input" />
            </div>
            <div>
              <label htmlFor="startTime" className="oc-label">
                Start
              </label>
              <input id="startTime" name="startTime" type="time" required defaultValue={occurrenceDefaults?.startTime ?? ""} className="oc-input" />
            </div>
            <div>
              <label htmlFor="endTime" className="oc-label">
                End
              </label>
              <input id="endTime" name="endTime" type="time" required defaultValue={occurrenceDefaults?.endTime ?? ""} className="oc-input" />
              <p className="mt-1 text-xs text-ink-soft">An end before the start runs overnight.</p>
            </div>
          </div>
        </section>
      ) : null}

      {meta.schedule === "recurring" ? (
        <section className="oc-card space-y-4 p-6">
          <h2 className="text-lg font-semibold">Weekly pattern</h2>
          <p className="text-sm text-ink-soft">
            Times are in the location&apos;s timezone. Dates are created 8 weeks ahead and extended
            automatically.
          </p>
          <div>
            <span className="oc-label">Days of the week</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {DAY_LABELS.map((label, day) => (
                <label
                  key={day}
                  className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:border-lilac-soft"
                >
                  <input type="checkbox" name="daysOfWeek" value={day} defaultChecked={weekly?.byDay.includes(day) ?? false} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="startTime" className="oc-label">
                Start time
              </label>
              <input
                id="startTime"
                name="startTime"
                type="time"
                required
                defaultValue={opportunity?.recurrenceLocalStart?.slice(0, 5) ?? ""}
                className="oc-input"
              />
            </div>
            <div>
              <label htmlFor="endTime" className="oc-label">
                End time
              </label>
              <input id="endTime" name="endTime" type="time" required defaultValue={recurringEnd} className="oc-input" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="startDate" className="oc-label">
                First date
              </label>
              <input
                id="startDate"
                name="startDate"
                type="date"
                required
                defaultValue={opportunity ? DateTime.now().setZone(tz).toFormat("yyyy-MM-dd") : ""}
                className="oc-input"
              />
            </div>
            <div>
              <label htmlFor="untilDate" className="oc-label">
                Last date (optional)
              </label>
              <input id="untilDate" name="untilDate" type="date" defaultValue={weekly?.until ?? ""} className="oc-input" />
              <p className="mt-1 text-xs text-ink-soft">Leave empty for ongoing.</p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="oc-card space-y-4 p-6">
        <h2 className="text-lg font-semibold">Pay{meta.payRequired ? "" : " (optional, encouraged)"}</h2>
        <p className="text-sm text-ink-soft">
          {meta.payRequired
            ? "Pay is always visible for this type — fixed, a range, or a negotiable minimum. Posts without pay are rejected."
            : "Posts that show pay get more interest. Leave empty to discuss in conversation."}
        </p>
        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="payKind" className="oc-label">
              Structure
            </label>
            <select id="payKind" name="payKind" required={meta.payRequired} defaultValue={opportunity?.payKind ?? (meta.payRequired ? "fixed" : "")} className="oc-input">
              {!meta.payRequired ? <option value="">Not shown</option> : null}
              <option value="fixed">Fixed</option>
              <option value="range">Range</option>
              <option value="negotiable_min">Negotiable, minimum shown</option>
            </select>
          </div>
          <div>
            <label htmlFor="payUnit" className="oc-label">
              Unit
            </label>
            <select id="payUnit" name="payUnit" required={meta.payRequired} defaultValue={opportunity?.payUnit ?? "hour"} className="oc-input">
              <option value="hour">Per hour</option>
              <option value="day">Per day</option>
              <option value="per_treatment">Per treatment</option>
              <option value="commission_pct">Commission %</option>
              <option value="salary_year">Salary / year</option>
              <option value="flat">Flat</option>
            </select>
          </div>
          <div>
            <label htmlFor="payMin" className="oc-label">
              Minimum ($ or %)
            </label>
            <input
              id="payMin"
              name="payMin"
              type="number"
              min={0}
              step="0.01"
              required={meta.payRequired}
              defaultValue={opportunity?.payMinCents != null ? opportunity.payMinCents / 100 : ""}
              className="oc-input"
            />
          </div>
          <div>
            <label htmlFor="payMax" className="oc-label">
              Maximum (range only)
            </label>
            <input
              id="payMax"
              name="payMax"
              type="number"
              min={0}
              step="0.01"
              defaultValue={opportunity?.payMaxCents != null ? opportunity.payMaxCents / 100 : ""}
              className="oc-input"
            />
          </div>
        </div>
      </section>

      <section className="oc-card space-y-4 p-6">
        <h2 className="text-lg font-semibold">Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="expectedVolume" className="oc-label">
              Expected client volume (optional)
            </label>
            <input
              id="expectedVolume"
              name="expectedVolume"
              defaultValue={opportunity?.expectedVolume ?? ""}
              placeholder="e.g. 8–12 clients/day"
              className="oc-input"
            />
          </div>
          <div>
            <label htmlFor="liabilityExpectations" className="oc-label">
              Liability / insurance expectations (optional)
            </label>
            <input
              id="liabilityExpectations"
              name="liabilityExpectations"
              defaultValue={opportunity?.liabilityExpectations ?? ""}
              placeholder="e.g. Own malpractice coverage required"
              className="oc-input"
            />
          </div>
        </div>
        <div>
          <label htmlFor="notes" className="oc-label">
            Anything else providers should know (optional)
          </label>
          <textarea id="notes" name="notes" rows={2} defaultValue={opportunity?.notes ?? ""} className="oc-input" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="applicationDeadline" className="oc-label">
              Application deadline (optional)
            </label>
            <input
              id="applicationDeadline"
              name="applicationDeadline"
              type="datetime-local"
              defaultValue={toLocalInput(opportunity?.applicationDeadline ?? null, tz)}
              className="oc-input"
            />
          </div>
          <div>
            <label htmlFor="expiresAt" className="oc-label">
              Auto-expire (optional)
            </label>
            <input
              id="expiresAt"
              name="expiresAt"
              type="datetime-local"
              defaultValue={toLocalInput(opportunity?.expiresAt ?? null, tz)}
              className="oc-input"
            />
            <p className="mt-1 text-xs text-ink-soft">The post comes down automatically at this time.</p>
          </div>
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
          <input type="checkbox" name="urgent" defaultChecked={opportunity?.urgent ?? false} className="mt-0.5" />
          <span>
            <span className="font-medium">Urgent.</span>{" "}
            <span className="text-ink-soft">
              Same-day or short-notice need — providers who opted into texts get an SMS when the
              first date is under 24 hours out.
            </span>
          </span>
        </label>
        {hasHighRisk ? (
          <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
            <input
              type="checkbox"
              name="supervisionAttested"
              defaultChecked={Boolean(opportunity?.supervisionAttestedAt)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Supervision attestation.</span>{" "}
              <span className="text-ink-soft">
                Required when the post includes injectables, laser, or IV services: I attest this
                work is performed under an appropriate supervision / medical-director arrangement
                as described on the location.
              </span>
            </span>
          </label>
        ) : null}
      </section>
    </>
  );
}
