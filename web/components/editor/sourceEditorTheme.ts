import { EditorView, type Extension } from "@uiw/react-codemirror";

const LIGHT = {
  codeBg: "oklch(0.97 0.004 70)",
  ink: "oklch(0.23 0.02 55)",
  muted: "oklch(0.53 0.025 55)",
  brand: "oklch(0.66 0.19 38)",
  brandWeak: "oklch(0.96 0.045 55)",
  border: "oklch(0.92 0.008 70)",
} as const;

const DARK = {
  codeBg: "oklch(0.27 0.012 65)",
  ink: "oklch(0.95 0.012 75)",
  muted: "oklch(0.72 0.022 70)",
  brand: "oklch(0.72 0.17 42)",
  brandWeak: "oklch(0.32 0.06 45)",
  border: "oklch(0.32 0.012 65)",
} as const;

/** CodeMirror theme — hardcoded OKLCH matches globals.css so it works even when CM overrides cascade. */
export function omsSourceTheme(isDark: boolean): Extension {
  const t = isDark ? DARK : LIGHT;
  return EditorView.theme(
    {
      "&": {
        backgroundColor: t.codeBg,
        color: t.ink,
        fontSize: "0.875rem",
        borderRadius: "0.5rem",
        border: `1px solid ${t.border}`,
      },
      ".cm-scroller": {
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      },
      ".cm-content": {
        caretColor: t.brand,
        padding: "0.65rem 0",
        minHeight: "8rem",
      },
      ".cm-line": {
        color: t.ink,
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: t.brand,
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: `${t.brandWeak} !important`,
      },
      ".cm-activeLine": {
        backgroundColor: `color-mix(in oklch, ${t.brandWeak} 55%, transparent)`,
      },
      ".cm-gutters": {
        backgroundColor: t.codeBg,
        color: t.muted,
        border: "none",
      },
    },
    { dark: isDark },
  );
}
