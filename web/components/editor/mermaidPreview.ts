export function isMermaidLanguage(lang: string | null | undefined): boolean {
  if (!lang) return false;
  return lang.toLowerCase().trim() === "mermaid";
}

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        fontFamily: "system-ui, sans-serif",
      });
      return mod.default;
    });
  }
  return mermaidReady;
}

/** Render mermaid source to an SVG string (client-only). */
export async function renderMermaidSvg(source: string, id: string): Promise<string> {
  const mermaid = await loadMermaid();
  const { svg } = await mermaid.render(id, source.trim() || "flowchart LR\n  A[Empty]");
  return svg;
}
