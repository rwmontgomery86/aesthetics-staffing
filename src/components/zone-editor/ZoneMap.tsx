"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Circle, Polygon, Polyline, TileLayer, useMapEvents } from "react-leaflet";

export interface LatLng {
  lat: number;
  lng: number;
}

const ATLANTA: LatLng = { lat: 33.749, lng: -84.388 };

function ClickCapture({ onClick }: { onClick: (point: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onClick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/** The Leaflet surface for radius + polygon zones. Touch-friendly: tap to
 *  place the center (radius) or add vertices (polygon). */
export function ZoneMap({
  mode,
  center,
  radiusMeters,
  points,
  onMapClick,
}: {
  mode: "radius" | "polygon";
  center: LatLng | null;
  radiusMeters: number;
  points: LatLng[];
  onMapClick: (point: LatLng) => void;
}) {
  const initialCenter = center ?? points[0] ?? ATLANTA;
  return (
    <MapContainer
      center={[initialCenter.lat, initialCenter.lng]}
      zoom={9}
      style={{ height: 380, width: "100%", borderRadius: 12, zIndex: 0 }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickCapture onClick={onMapClick} />

      {mode === "radius" && center ? (
        <>
          <CircleMarker center={[center.lat, center.lng]} radius={5} pathOptions={{ color: "#7E5FA3" }} />
          <Circle
            center={[center.lat, center.lng]}
            radius={radiusMeters}
            pathOptions={{ color: "#7E5FA3", fillColor: "#B49BC8", fillOpacity: 0.18 }}
          />
        </>
      ) : null}

      {mode === "polygon" && points.length > 0 ? (
        points.length >= 3 ? (
          <Polygon
            positions={points.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: "#7E5FA3", fillColor: "#B49BC8", fillOpacity: 0.18 }}
          />
        ) : (
          <Polyline positions={points.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#7E5FA3" }} />
        )
      ) : null}
      {mode === "polygon"
        ? points.map((p, index) => (
            <CircleMarker
              key={`${p.lat}-${p.lng}-${index}`}
              center={[p.lat, p.lng]}
              radius={4}
              pathOptions={{ color: "#7E5FA3" }}
            />
          ))
        : null}
    </MapContainer>
  );
}
