import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        border: "var(--border)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        brand: "var(--brand)",
        "brand-weak": "var(--brand-weak)",
        "brand-ink": "var(--brand-ink)",
        "accent-amber": "var(--accent-amber)",
        "accent-pink": "var(--accent-pink)",
        "accent-sky": "var(--accent-sky)",
        "accent-mint": "var(--accent-mint)",
        "vis-public": "var(--vis-public)",
        "vis-private": "var(--vis-private)",
        "vis-secret": "var(--vis-secret)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
      },
      transitionTimingFunction: {
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
