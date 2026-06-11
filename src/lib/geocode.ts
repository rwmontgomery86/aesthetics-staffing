/**
 * Geocoder — converts a free-form address to lat/lng (NotifEyes port).
 *
 * Default: Nominatim (OpenStreetMap). Free, no token, but rate-limited to
 * 1 req/sec and requires a meaningful User-Agent per their usage policy:
 *   https://operations.osmfoundation.org/policies/nominatim/
 *
 * Prod: Mapbox when `MAPBOX_TOKEN` is set (higher rate limits, no UA policy).
 * Both implement the `Geocoder` interface; callers use the exported
 * `geocoder` singleton. A null result is normal (timeouts, no match) —
 * callers fall back to the ZIP-boundary centroid from geo_zips.
 */

import "server-only";
import { brand } from "@/config/brand";

// process.env read lazily (NOT via @/env): importing the validated env from a
// route module forces full validation at build time, and CI builds without
// database URLs (same reason src/db/client.ts reads process.env directly).
const mapboxToken = () => process.env.MAPBOX_TOKEN;

export interface GeocodeInput {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  source: string;
}

export interface Geocoder {
  geocode(input: GeocodeInput): Promise<GeocodeResult | null>;
}

// Brand stays config-driven, even in a user agent (BRAND_AND_COPY_NOTES).
const userAgent = () =>
  `${brand.name}/0.1 ${process.env.SUPPORT_EMAIL ?? "support@example.test"}`;

/**
 * Georgia bounding box (generous). Launch is GA-only at the validation level,
 * so a geocode hit outside this box means the provider matched the wrong
 * place entirely — callers should prefer the ZIP centroid instead.
 */
export function withinGaBounds(lat: number, lng: number): boolean {
  return lat >= 30.2 && lat <= 35.1 && lng >= -85.8 && lng <= -80.6;
}

/**
 * IANA timezone resolved at geocode time. All of Georgia is Eastern; revisit
 * with a real lat/lng→tz lookup before multi-state rollout (split-timezone
 * states make a state→tz map wrong).
 */
export function timezoneForState(state: string): string {
  void state; // GA-only launch
  return "America/New_York";
}

/**
 * Last call timestamp for naive rate-limiting. Single-process only; if the
 * app scales beyond one node, replace with a token bucket (or set
 * MAPBOX_TOKEN and skip Nominatim entirely).
 */
let _lastCallAt = 0;

async function rateLimit(): Promise<void> {
  const elapsed = Date.now() - _lastCallAt;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  _lastCallAt = Date.now();
}

function buildQuery(input: GeocodeInput): string {
  return [input.addressLine, input.city, input.state, input.zip].filter(Boolean).join(", ");
}

export const nominatimGeocoder: Geocoder = {
  async geocode(input: GeocodeInput): Promise<GeocodeResult | null> {
    const q = buildQuery(input);
    if (!q.trim()) return null;

    await rateLimit();

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "us");
    url.searchParams.set("addressdetails", "0");

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent(), Accept: "application/json" },
        // Don't blow up the save if Nominatim is slow — caller falls back.
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        console.warn(`[geocode] nominatim ${res.status} for "${q}"`);
        return null;
      }
      const rows = (await res.json()) as { lat: string; lon: string }[];
      const first = rows[0];
      if (!first) return null;
      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng, source: "nominatim" };
    } catch (err) {
      console.warn("[geocode] nominatim failed:", err);
      return null;
    }
  },
};

/**
 * Mapbox geocoder. Uses the same access token as map tiles (a public `pk.…`
 * token is fine). Returns `[lng, lat]` in `feature.center`.
 */
export const mapboxGeocoder: Geocoder = {
  async geocode(input: GeocodeInput): Promise<GeocodeResult | null> {
    const token = mapboxToken();
    if (!token) return null;

    const q = buildQuery(input);
    if (!q.trim()) return null;

    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`,
    );
    url.searchParams.set("access_token", token);
    url.searchParams.set("limit", "1");
    url.searchParams.set("country", "us");
    url.searchParams.set("types", "address,postcode,place");

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        console.warn(`[geocode] mapbox ${res.status} for "${q}"`);
        return null;
      }
      const data = (await res.json()) as {
        features?: { center?: [number, number] }[];
      };
      const center = data.features?.[0]?.center;
      if (!center) return null;
      const [lng, lat] = center;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng, source: "mapbox" };
    } catch (err) {
      console.warn("[geocode] mapbox failed:", err);
      return null;
    }
  },
};

// Prefer Mapbox when a token is present; otherwise the no-token Nominatim
// path. Resolved per call so the choice doesn't freeze at import time.
export const geocoder: Geocoder = {
  geocode: (input) => (mapboxToken() ? mapboxGeocoder : nominatimGeocoder).geocode(input),
};
