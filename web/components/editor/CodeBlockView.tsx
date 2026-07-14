"use client";

import { useEffect, useId, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Copy, Eye, EyeOff, Code2, GitBranch } from "lucide-react";
import {
  buildHtmlPreviewSrcDoc,
  isHtmlPreviewLanguage,
  pingHtmlPreviewIframe,
} from "./htmlPreview";
import { isMermaidLanguage, renderMermaidSvg } from "./mermaidPreview";
import { cn } from "@/lib/utils";

export function CodeBlockView({ node }: NodeViewProps) {
  const lang = (node.attrs.language as string) || "";
  const isPreview = isHtmlPreviewLanguage(lang);
  const isMermaid = isMermaidLanguage(lang);
  const isRich = isPreview || isMermaid;
  const code = node.textContent;
  const [showPreview, setShowPreview] = useState(isRich);
  const [showSource, setShowSource] = useState(!isRich);
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(null);
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mermaidId = useId().replace(/:/g, "");

  useEffect(() => {
    if (!isPreview) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "oms-html-preview:resize") return;
      const height = Number(event.data.height);
      if (Number.isFinite(height) && height > 0) {
        setPreviewHeight(Math.min(Math.max(height + 8, 120), 720));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isPreview]);

  useEffect(() => {
    if (!isPreview || !showPreview) return;
    const t = window.setTimeout(() => pingHtmlPreviewIframe(iframeRef.current), 60);
    return () => window.clearTimeout(t);
  }, [isPreview, showPreview, code]);

  useEffect(() => {
    if (!isMermaid || !showPreview) {
      setMermaidSvg(null);
      setMermaidError(null);
      return;
    }
    let cancelled = false;
    setMermaidError(null);
    void renderMermaidSvg(code, `oms-mermaid-${mermaidId}`)
      .then((svg) => {
        if (!cancelled) setMermaidSvg(svg);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMermaidSvg(null);
          setMermaidError(err instanceof Error ? err.message : "Could not render diagram");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isMermaid, showPreview, code, mermaidId]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard unavailable */
    }
  }

  const previewFrameStyle = previewHeight
    ? { height: `${previewHeight}px` }
    : { height: "min(420px, 50vh)" };

  return (
    <NodeViewWrapper className={cn("group relative my-3", isRich && "oms-rich-code-block")}>
      <div className="absolute -top-9 right-0 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        {isRich && (
          <ToolbarButton
            label={showPreview ? "Hide preview" : "Show preview"}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </ToolbarButton>
        )}
        {isRich && (
          <ToolbarButton label={showSource ? "Hide source" : "Show source"} onClick={() => setShowSource((v) => !v)}>
            <Code2 className="h-3.5 w-3.5" />
          </ToolbarButton>
        )}
        <ToolbarButton label="Copy" onClick={copyCode}>
          <Copy className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted">
          {isMermaid ? (
            <span className="inline-flex items-center gap-0.5">
              <GitBranch className="h-3 w-3" />
              mermaid
            </span>
          ) : (
            lang || "plain"
          )}
        </span>
      </div>

      {isPreview && showPreview && (
        <div className="overflow-hidden rounded-lg border border-border">
          <iframe
            ref={iframeRef}
            title="HTML preview"
            sandbox="allow-scripts"
            srcDoc={buildHtmlPreviewSrcDoc(code)}
            className="block min-h-[120px] w-full border-0 bg-bg"
            style={previewFrameStyle}
          />
        </div>
      )}

      {isMermaid && showPreview && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface p-3">
          {mermaidError ? (
            <p className="text-sm text-muted">{mermaidError}</p>
          ) : mermaidSvg ? (
            <div
              className="oms-mermaid-preview flex justify-center [&_svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: mermaidSvg }}
            />
          ) : (
            <p className="text-sm text-muted">Rendering diagram…</p>
          )}
        </div>
      )}

      {showSource && (
        <pre
          className={cn(
            "overflow-x-auto rounded-lg border border-border bg-code-bg p-3 text-sm",
            isRich && showPreview && "mt-2",
          )}
        >
          <NodeViewContent as={"code" as "div"} className={cn("font-mono", lang && `language-${lang}`)} />
        </pre>
      )}
    </NodeViewWrapper>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded p-1 text-muted hover:bg-bg hover:text-ink"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
