import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        elevated: "var(--elevated)",
        border: "var(--border)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        brand: "var(--brand)",
        "brand-weak": "var(--brand-weak)",
        "brand-ink": "var(--brand-ink)",
        "accent-teal": "var(--accent-teal)",
        "accent-lime": "var(--accent-lime)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
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
