import { brand } from "@/config/brand";

export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "4rem 2rem", maxWidth: 640, margin: "0 auto" }}>
      <h1>{brand.name}</h1>
      <p>{brand.tagline}</p>
      <p style={{ color: "#666" }}>
        Phase 1 — database &amp; security foundation. UI begins in Phase 2.
      </p>
    </main>
  );
}
