"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { LatLng } from "./ZoneMap";

// Leaflet touches `window` — render the map client-side only.
const ZoneMap = dynamic(() => import("./ZoneMap").then((module) => module.ZoneMap), {
  ssr: false,
  loading: () => <div className="h-[380px] w-full animate-pulse rounded-xl bg-ink/5" />,
});

export type ZoneKind = "radius" | "polygon" | "city" | "zip";

export interface ZoneGeometryDefaults {
  kind: ZoneKind;
  center?: LatLng;
  radiusMeters?: number;
  points?: LatLng[];
  cityGeoid?: string;
  zip?: string;
}

const KIND_TABS: Array<{ kind: ZoneKind; label: string; blurb: string }> = [
  { kind: "radius", label: "Radius", blurb: "Tap the map to drop a center point, then set how far you'll travel." },
  { kind: "polygon", label: "Draw", blurb: "Tap the map to outline your own area, point by point." },
  { kind: "city", label: "City", blurb: "Use a Georgia city's official boundary." },
  { kind: "zip", label: "ZIP", blurb: "Use a Georgia ZIP code's boundary." },
];

const MILES_TO_METERS = 1609.34;

/**
 * Lives INSIDE the zone form: maintains the chosen kind + geometry in client
 * state, mirrors everything into hidden inputs the server action reads, and
 * re-renders an existing zone from its geometry_meta when editing.
 */
export function ZoneGeometryEditor({
  cities,
  defaults,
}: {
  cities: Array<{ geoid: string; name: string }>;
  defaults?: ZoneGeometryDefaults;
}) {
  const [kind, setKind] = useState<ZoneKind>(defaults?.kind ?? "radius");
  const [center, setCenter] = useState<LatLng | null>(defaults?.center ?? null);
  const [radiusMiles, setRadiusMiles] = useState(
    defaults?.radiusMeters ? Math.round(defaults.radiusMeters / MILES_TO_METERS) : 25,
  );
  const [points, setPoints] = useState<LatLng[]>(defaults?.points ?? []);
  const [cityGeoid, setCityGeoid] = useState(defaults?.cityGeoid ?? "");
  const [zip, setZip] = useState(defaults?.zip ?? "");
  const [citySearch, setCitySearch] = useState(
    defaults?.cityGeoid ? (cities.find((c) => c.geoid === defaults.cityGeoid)?.name ?? "") : "",
  );

  const cityMatches =
    citySearch.length >= 2 && !cityGeoid
      ? cities.filter((c) => c.name.toLowerCase().startsWith(citySearch.toLowerCase())).slice(0, 8)
      : [];

  function handleMapClick(point: LatLng) {
    if (kind === "radius") setCenter(point);
    if (kind === "polygon") setPoints((current) => [...current, point]);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={kind === tab.kind}
            onClick={() => setKind(tab.kind)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              kind === tab.kind ? "bg-ink text-paper" : "border border-line text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-soft">{KIND_TABS.find((tab) => tab.kind === kind)?.blurb}</p>

      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="centerLat" value={center?.lat ?? ""} />
      <input type="hidden" name="centerLng" value={center?.lng ?? ""} />
      <input type="hidden" name="radiusMeters" value={Math.round(radiusMiles * MILES_TO_METERS)} />
      <input type="hidden" name="points" value={JSON.stringify(points)} />
      <input type="hidden" name="cityGeoid" value={cityGeoid} />
      <input type="hidden" name="zip" value={kind === "zip" ? zip : ""} />

      {kind === "radius" || kind === "polygon" ? (
        <div className="mt-4">
          <ZoneMap
            mode={kind}
            center={center}
            radiusMeters={radiusMiles * MILES_TO_METERS}
            points={points}
            onMapClick={handleMapClick}
          />
          {kind === "radius" ? (
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={5}
                max={120}
                value={radiusMiles}
                onChange={(event) => setRadiusMiles(Number(event.target.value))}
                className="w-full accent-[#7E5FA3]"
              />
              <span className="whitespace-nowrap text-sm font-medium">{radiusMiles} mi</span>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-ink-soft">{points.length} point{points.length === 1 ? "" : "s"}</span>
              <button
                type="button"
                onClick={() => setPoints((current) => current.slice(0, -1))}
                className="oc-btn-ghost"
                disabled={points.length === 0}
              >
                Undo point
              </button>
              <button
                type="button"
                onClick={() => setPoints([])}
                className="oc-btn-ghost text-danger"
                disabled={points.length === 0}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      ) : null}

      {kind === "city" ? (
        <div className="mt-4 max-w-sm">
          <label className="oc-label">Georgia city</label>
          <input
            value={citySearch}
            onChange={(event) => {
              setCitySearch(event.target.value);
              setCityGeoid("");
            }}
            placeholder="Start typing — e.g. Atlanta"
            className="oc-input"
          />
          {cityMatches.length > 0 ? (
            <ul className="oc-card mt-1 divide-y divide-line">
              {cityMatches.map((city) => (
                <li key={city.geoid}>
                  <button
                    type="button"
                    onClick={() => {
                      setCityGeoid(city.geoid);
                      setCitySearch(city.name);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-ink/5"
                  >
                    {city.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {cityGeoid ? <p className="oc-notice mt-2">Boundary on file ✓</p> : null}
        </div>
      ) : null}

      {kind === "zip" ? (
        <div className="mt-4 max-w-48">
          <label className="oc-label">Georgia ZIP code</label>
          <input
            value={zip}
            onChange={(event) => setZip(event.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            placeholder="30309"
            className="oc-input"
          />
        </div>
      ) : null}
    </div>
  );
}
