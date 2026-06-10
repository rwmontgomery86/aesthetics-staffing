import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import { brand } from "@/config/brand";
import "./globals.css";

// Playfair's high-contrast Didone forms match the wordmark's typography.
const display = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
});
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.tagline,
  robots: { index: false, follow: false }, // pre-launch: nothing is indexable
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
