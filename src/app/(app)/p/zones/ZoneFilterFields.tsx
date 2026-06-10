/** Server-rendered filter inputs shared by the new + edit zone forms. */

const OPPORTUNITY_TYPE_OPTIONS = [
  { value: "one_time_shift", label: "One-time shifts" },
  { value: "recurring_shift", label: "Recurring shifts" },
  { value: "part_time", label: "Part-time roles" },
  { value: "full_time", label: "Full-time roles" },
  { value: "contract", label: "Contract roles" },
  { value: "popup_event", label: "Pop-up events" },
  { value: "evergreen", label: "Open applications" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ZoneFilterDefaults {
  opportunityTypes: string[];
  serviceIds: string[];
  minPayCents: number | null;
  minPayUnit: string;
  daysOfWeek: number[];
  timeStart: string | null;
  timeEnd: string | null;
  urgentOnly: boolean;
  exactOnly: boolean;
  channelEmail: boolean;
  channelSms: boolean;
}

export const EMPTY_FILTER_DEFAULTS: ZoneFilterDefaults = {
  opportunityTypes: [],
  serviceIds: [],
  minPayCents: null,
  minPayUnit: "hour",
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  timeStart: null,
  timeEnd: null,
  urgentOnly: false,
  exactOnly: false,
  channelEmail: true,
  channelSms: false,
};

export function ZoneFilterFields({
  defaults,
  myServices,
  smsAvailable,
}: {
  defaults: ZoneFilterDefaults;
  myServices: Array<{ id: string; name: string }>;
  smsAvailable: boolean;
}) {
  const allTypes = defaults.opportunityTypes.length === 0;
  const allServices = defaults.serviceIds.length === 0;
  const days = new Set(defaults.daysOfWeek);

  return (
    <>
      <section>
        <h2 className="oc-label">Opportunity types (leave all checked for everything)</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPPORTUNITY_TYPE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="opportunityType"
                value={option.value}
                defaultChecked={allTypes || defaults.opportunityTypes.includes(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </section>

      {myServices.length > 0 ? (
        <section>
          <h2 className="oc-label">Only alert me for these services (leave unchecked for all of mine)</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {myServices.map((service) => (
              <label key={service.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="serviceFilter"
                  value={service.id}
                  defaultChecked={!allServices && defaults.serviceIds.includes(service.id)}
                />
                {service.name}
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="oc-label">Minimum pay (optional)</label>
          <div className="flex items-center gap-1">
            <span className="text-ink-soft">$</span>
            <input
              name="minPay"
              type="number"
              min={0}
              step="0.01"
              defaultValue={defaults.minPayCents != null ? defaults.minPayCents / 100 : ""}
              className="oc-input"
            />
          </div>
        </div>
        <div>
          <label className="oc-label">Per</label>
          <select name="minPayUnit" defaultValue={defaults.minPayUnit} className="oc-input">
            <option value="hour">Hour</option>
            <option value="day">Day</option>
            <option value="per_treatment">Treatment</option>
            <option value="flat">Flat rate</option>
          </select>
        </div>
        <div className="flex items-end pb-2">
          <p className="text-xs text-ink-soft">
            You&apos;ll still see close matches slightly under this — labeled honestly.
          </p>
        </div>
      </section>

      <section>
        <h2 className="oc-label">Days</h2>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day, index) => (
            <label
              key={day}
              className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm"
            >
              <input type="checkbox" name="day" value={index} defaultChecked={days.has(index)} />
              {day}
            </label>
          ))}
        </div>
        <div className="mt-3 grid max-w-sm grid-cols-2 gap-4">
          <div>
            <label className="oc-label">From (optional)</label>
            <input name="timeStart" type="time" defaultValue={defaults.timeStart ?? ""} className="oc-input" />
          </div>
          <div>
            <label className="oc-label">Until (optional)</label>
            <input name="timeEnd" type="time" defaultValue={defaults.timeEnd ?? ""} className="oc-input" />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="exactOnly" defaultChecked={defaults.exactOnly} />
          <span>
            <span className="font-medium">Exact matches only.</span>{" "}
            <span className="text-ink-soft">Skip "close match" alerts for this zone.</span>
          </span>
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="urgentOnly" defaultChecked={defaults.urgentOnly} />
          <span>
            <span className="font-medium">Urgent only.</span>{" "}
            <span className="text-ink-soft">Only same-day / urgent coverage alerts.</span>
          </span>
        </label>
      </section>

      <section>
        <h2 className="oc-label">How should this zone reach you?</h2>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked readOnly disabled />
            In-app (always on)
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" name="channelEmail" defaultChecked={defaults.channelEmail} />
            Email
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" name="channelSms" defaultChecked={defaults.channelSms} disabled={!smsAvailable} />
            <span>
              Text message{" "}
              {!smsAvailable ? (
                <span className="text-ink-soft">(verify your phone in Profile first — arriving with notifications in Phase 6)</span>
              ) : null}
            </span>
          </label>
        </div>
      </section>
    </>
  );
}
