export function isMermaidLanguage(lang: string | null | undefined): boolean {
  if (!lang) return false;
  return lang.toLowerCase().trim() === "mermaid";
}

type MermaidTheme = "light" | "dark";

type MermaidModule = typeof import("mermaid").default;

let mermaidReady: Promise<MermaidModule> | null = null;
let appliedTheme: MermaidTheme | null = null;

const SLICES = ["#f0b429", "#5aa9e6", "#5fcfa8", "#e07a5f", "#9b8cff", "#f4a261", "#2a9d8f", "#e9c46a"];

/** Match the app body face — resolve the live CSS token so next/font hashes work. */
function appFontFamily(): string {
  if (typeof document === "undefined") {
    return '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif';
  }
  const token = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  return token || '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif';
}

function themeVariables(mode: MermaidTheme) {
  const ink = mode === "dark" ? "#f2ebe0" : "#2b2620";
  const muted = mode === "dark" ? "#b5a894" : "#7a6f62";
  const tick = mode === "dark" ? "#5a5248" : "#cfc6b8";
  const nodeFill = mode === "dark" ? "#3a3228" : "#fff8e8";
  const cluster = mode === "dark" ? "#2a241c" : "#f7f3ec";
  const fontFamily = appFontFamily();

  return {
    background: "transparent",
    fontFamily,
    primaryColor: "#f0b429",
    primaryTextColor: ink,
    primaryBorderColor: "#d49a1a",
    secondaryColor: "#5aa9e6",
    secondaryTextColor: ink,
    secondaryBorderColor: "#3d8fc4",
    tertiaryColor: "#5fcfa8",
    tertiaryTextColor: ink,
    tertiaryBorderColor: "#3dab86",
    lineColor: muted,
    textColor: ink,
    mainBkg: nodeFill,
    nodeBorder: "#d49a1a",
    clusterBkg: cluster,
    titleColor: ink,
    pie1: SLICES[0],
    pie2: SLICES[1],
    pie3: SLICES[2],
    pie4: SLICES[3],
    pie5: SLICES[4],
    pie6: SLICES[5],
    pie7: SLICES[6],
    pie8: SLICES[7],
    pieTitleTextColor: ink,
    pieSectionTextColor: ink,
    pieLegendTextColor: ink,
    xyChart: {
      backgroundColor: "transparent",
      titleColor: ink,
      xAxisLabelColor: muted,
      xAxisTitleColor: ink,
      xAxisTickColor: tick,
      xAxisLineColor: tick,
      yAxisLabelColor: muted,
      yAxisTitleColor: ink,
      yAxisTickColor: tick,
      yAxisLineColor: tick,
      plotColorPalette: SLICES.join(","),
    },
  };
}

function currentTheme(): MermaidTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function configure(mermaid: MermaidModule, mode: MermaidTheme) {
  const fontFamily = appFontFamily();
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: themeVariables(mode),
    securityLevel: "strict",
    fontFamily,
  });
  appliedTheme = mode;
}

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      configure(mod.default, currentTheme());
      return mod.default;
    });
  }
  return mermaidReady;
}

/** Render mermaid source to an SVG string (client-only). */
export async function renderMermaidSvg(source: string, id: string): Promise<string> {
  const mermaid = await loadMermaid();
  const mode = currentTheme();
  if (appliedTheme !== mode) configure(mermaid, mode);
  const { svg } = await mermaid.render(id, source.trim() || "flowchart LR\n  A[Empty]");
  return svg;
}

/** Subscribe to `data-theme` flips so diagrams can re-render with readable ink. */
export function subscribeTheme(listener: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === "data-theme")) listener();
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function readTheme(): MermaidTheme {
  return currentTheme();
}
