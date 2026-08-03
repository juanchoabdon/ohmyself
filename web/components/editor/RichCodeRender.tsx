"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { buildHtmlPreviewSrcDoc, pingHtmlPreviewIframe } from "./htmlPreview";
import { readTheme, renderMermaidSvg, subscribeTheme } from "./mermaidPreview";

/**
 * The two code blocks that render as something other than code: a mermaid
 * diagram and a sandboxed HTML preview.
 *
 * Shared by the editor's node view and the read-only renderer, so a note looks
 * the same whether or not you're editing it.
 */

/** The info string of a fenced block, as rehype leaves it: `language-html`. */
export function languageFromClassName(className?: string): string | null {
  const match = /language-([\w-]+)/.exec(className || "");
  return match?.[1]?.replace(/-/g, " ") ?? null;
}

export function MermaidDiagram({ code, fallback }: { code: string; fallback?: React.ReactNode }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId().replace(/:/g, "");
  // SVG ink is baked at render time — re-render when light/dark flips.
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "light" as const);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);
    void renderMermaidSvg(code, `oms-mermaid-${id}`)
      .then((rendered) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSvg(null);
        setError(err instanceof Error ? err.message : "Could not render diagram");
      });
    return () => {
      cancelled = true;
    };
  }, [code, id, theme]);

  // Bad syntax shouldn't swallow the content — show the source instead.
  if (error) return <>{fallback ?? <p className="text-sm text-muted">{error}</p>}</>;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface p-3">
      {svg ? (
        <div
          className="oms-mermaid-preview flex justify-center [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <p className="text-sm text-muted">Rendering diagram…</p>
      )}
    </div>
  );
}

/** Height the sandboxed document reports about itself, clamped to something sane. */
export function useReportedHeight(
  active: boolean,
  code: string,
  ref: React.RefObject<HTMLIFrameElement | null>,
): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "oms-html-preview:resize") return;
      const reported = Number(event.data.height);
      if (Number.isFinite(reported) && reported > 0) {
        setHeight(Math.min(Math.max(reported + 8, 120), 720));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => pingHtmlPreviewIframe(ref.current), 60);
    return () => window.clearTimeout(t);
  }, [active, code, ref]);

  return height;
}

export function HtmlPreview({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const height = useReportedHeight(true, html, ref);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <iframe
        ref={ref}
        title="HTML preview"
        sandbox="allow-scripts"
        srcDoc={buildHtmlPreviewSrcDoc(html)}
        className="block min-h-[120px] w-full border-0 bg-bg"
        style={height ? { height: `${height}px` } : { height: "min(420px, 50vh)" }}
      />
    </div>
  );
}
