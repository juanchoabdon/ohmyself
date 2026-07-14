/** Theme tokens agents can reference in HTML preview starters (palette MCP). */
export const HTML_PREVIEW_THEME_VARS = {
  "--ink": "oklch(0.23 0.02 55)",
  "--muted": "oklch(0.53 0.025 55)",
  "--border": "oklch(0.92 0.008 70)",
  "--brand": "oklch(0.66 0.19 38)",
  "--surface": "oklch(1 0 0)",
} as const;

const HTML_PREVIEW_BRIDGE_SCRIPT = `
<script>
(function () {
  function applyTheme(vars) {
    if (!vars || typeof vars !== "object") return;
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v === "string") document.documentElement.style.setProperty(k, v);
    }
  }
  function reportHeight() {
    var h = Math.max(
      document.documentElement.scrollHeight || 0,
      document.body ? document.body.scrollHeight : 0,
      120
    );
    parent.postMessage({ type: "oms-html-preview:resize", height: h }, "*");
  }
  window.addEventListener("message", function (e) {
    var data = e.data;
    if (!data || typeof data.type !== "string") return;
    if (data.type === "oms-html-preview:theme") applyTheme(data.vars);
    if (data.type === "oms-html-preview:ping") reportHeight();
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reportHeight);
  } else {
    reportHeight();
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(reportHeight).observe(document.body);
  }
})();
</script>`;

/** Sandboxed HTML preview document with app theme tokens + postMessage bridge. */
export function buildHtmlPreviewSrcDoc(html: string): string {
  const vars = Object.entries(HTML_PREVIEW_THEME_VARS)
    .map(([k, v]) => `${k}: ${v};`)
    .join("\n  ");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root {
  color-scheme: light dark;
  ${vars}
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
</style></head><body>${html}</body>${HTML_PREVIEW_BRIDGE_SCRIPT}</html>`;
}

export function isHtmlPreviewLanguage(lang: string | null | undefined): boolean {
  if (!lang) return false;
  const n = lang.toLowerCase().trim();
  return n === "html" || n === "html preview" || n.startsWith("html ");
}

/** Notify an HTML preview iframe to re-measure (parent → child). */
export function pingHtmlPreviewIframe(iframe: HTMLIFrameElement | null | undefined) {
  iframe?.contentWindow?.postMessage({ type: "oms-html-preview:ping" }, "*");
}
