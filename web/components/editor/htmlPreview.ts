/** Sandboxed HTML preview document with app theme tokens. */
export function buildHtmlPreviewSrcDoc(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root {
  color-scheme: light dark;
  --ink: oklch(0.23 0.02 55);
  --muted: oklch(0.53 0.025 55);
  --border: oklch(0.92 0.008 70);
  --brand: oklch(0.66 0.19 38);
  --surface: oklch(1 0 0);
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: oklch(0.95 0.012 75);
    --muted: oklch(0.72 0.022 70);
    --border: oklch(0.32 0.012 65);
    --brand: oklch(0.72 0.17 42);
    --surface: oklch(0.235 0.012 65);
  }
}
html, body { margin: 0; padding: 0; background: transparent; color: var(--ink); font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5; }
a { color: var(--brand); }
</style></head><body>${html}</body></html>`;
}

export function isHtmlPreviewLanguage(lang: string | null | undefined): boolean {
  if (!lang) return false;
  const n = lang.toLowerCase().trim();
  return n === "html" || n === "html preview" || n.startsWith("html ");
}
