import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Off because of Leaflet: strict mode's dev-only double-mount re-initializes
  // the imperative map on the same DOM node ("Map container is already
  // initialized"). NotifEyes sidestepped this with raw Leaflet; react-leaflet
  // hits it head-on. No production behavior change.
  reactStrictMode: false,
};

export default nextConfig;
