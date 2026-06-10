import type { Config } from "tailwindcss";

/**
 * Design tokens live as CSS variables in globals.css (rebrandable in one
 * place — the working name is tentative). Channel-triplet form so Tailwind
 * opacity modifiers (e.g. bg-ink/60) work.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "rgb(var(--c-paper) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        "ink-soft": "rgb(var(--c-ink-soft) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        lilac: "rgb(var(--c-lilac) / <alpha-value>)",
        "lilac-soft": "rgb(var(--c-lilac-soft) / <alpha-value>)",
        blush: "rgb(var(--c-blush) / <alpha-value>)",
        "blush-deep": "rgb(var(--c-blush-deep) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
        success: "rgb(var(--c-success) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "0.875rem",
      },
      boxShadow: {
        card: "0 1px 2px rgb(42 37 32 / 0.04), 0 4px 16px rgb(42 37 32 / 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
