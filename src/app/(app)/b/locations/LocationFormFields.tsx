import type { locations } from "@/db/schema";

type LocationRow = typeof locations.$inferSelect;

function listToText(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : "";
}

/** Shared field set for the create and edit forms. Server component. */
export function LocationFormFields({ location }: { location?: LocationRow }) {
  return (
    <>
      <div>
        <label htmlFor="name" className="oc-label">
          Location name
        </label>
        <input
          id="name"
          name="name"
          required
          minLength={2}
          defaultValue={location?.name ?? ""}
          placeholder="e.g. Buckhead studio"
          className="oc-input"
        />
        <p className="mt-1 text-xs text-ink-soft">
          Providers see this on opportunities — make it recognizable.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="addressLine1" className="oc-label">
            Street address
          </label>
          <input
            id="addressLine1"
            name="addressLine1"
            required
            defaultValue={location?.addressLine1 ?? ""}
            placeholder="123 Peachtree St NE"
            className="oc-input"
          />
        </div>
        <div>
          <label htmlFor="addressLine2" className="oc-label">
            Suite / floor (optional)
          </label>
          <input
            id="addressLine2"
            name="addressLine2"
            defaultValue={location?.addressLine2 ?? ""}
            placeholder="Suite 200"
            className="oc-input"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="city" className="oc-label">
            City
          </label>
          <input
            id="city"
            name="city"
            required
            defaultValue={location?.city ?? ""}
            placeholder="Atlanta"
            className="oc-input"
          />
        </div>
        <div>
          <label htmlFor="state" className="oc-label">
            State
          </label>
          <select id="state" name="state" defaultValue="GA" className="oc-input">
            <option value="GA">Georgia</option>
          </select>
          <p className="mt-1 text-xs text-ink-soft">Georgia-only at launch.</p>
        </div>
        <div>
          <label htmlFor="zip" className="oc-label">
            ZIP
          </label>
          <input
            id="zip"
            name="zip"
            required
            inputMode="numeric"
            pattern="\d{5}"
            defaultValue={location?.zip ?? ""}
            placeholder="30309"
            className="oc-input"
          />
        </div>
      </div>

      <div>
        <label htmlFor="phone" className="oc-label">
          Location phone (optional)
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={location?.phone ?? ""}
          placeholder="(404) 555-0100"
          className="oc-input"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="parkingNotes" className="oc-label">
            Parking notes (optional)
          </label>
          <textarea
            id="parkingNotes"
            name="parkingNotes"
            rows={2}
            defaultValue={location?.parkingNotes ?? ""}
            placeholder="Free deck behind the building, validate at front desk."
            className="oc-input"
          />
        </div>
        <div>
          <label htmlFor="dressCode" className="oc-label">
            Dress code (optional)
          </label>
          <textarea
            id="dressCode"
            name="dressCode"
            rows={2}
            defaultValue={location?.dressCode ?? ""}
            placeholder="Black scrubs; closed-toe shoes."
            className="oc-input"
          />
        </div>
      </div>

      <div>
        <label htmlFor="supervisionContext" className="oc-label">
          Medical supervision context (optional)
        </label>
        <textarea
          id="supervisionContext"
          name="supervisionContext"
          rows={3}
          defaultValue={location?.supervisionContext ?? ""}
          placeholder="e.g. Medical director on file (Dr. Smith, MD); standing orders for injectables; GFE via telehealth."
          className="oc-input"
        />
        <p className="mt-1 text-xs text-ink-soft">
          How supervision works at this location, in your own words. Shown to providers on
          injectable, laser, and similar posts.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="equipment" className="oc-label">
            Equipment / devices (optional)
          </label>
          <input
            id="equipment"
            name="equipment"
            defaultValue={listToText(location?.equipment)}
            placeholder="Candela GentleMax Pro, HydraFacial MD"
            className="oc-input"
          />
          <p className="mt-1 text-xs text-ink-soft">Separate with commas.</p>
        </div>
        <div>
          <label htmlFor="productsBrands" className="oc-label">
            Products / brands (optional)
          </label>
          <input
            id="productsBrands"
            name="productsBrands"
            defaultValue={listToText(location?.productsBrands)}
            placeholder="Botox, Juvéderm, SkinCeuticals"
            className="oc-input"
          />
          <p className="mt-1 text-xs text-ink-soft">Separate with commas.</p>
        </div>
      </div>
    </>
  );
}
