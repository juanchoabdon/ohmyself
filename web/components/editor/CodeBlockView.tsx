"use client";

import { useState } from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Copy, Eye, EyeOff, Code2 } from "lucide-react";
import { buildHtmlPreviewSrcDoc, isHtmlPreviewLanguage } from "./htmlPreview";
import { cn } from "@/lib/utils";

export function CodeBlockView({ node }: NodeViewProps) {
  const lang = (node.attrs.language as string) || "";
  const isPreview = isHtmlPreviewLanguage(lang);
  const code = node.textContent;
  const [showPreview, setShowPreview] = useState(true);
  const [showSource, setShowSource] = useState(!isPreview);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <NodeViewWrapper className={cn("group relative my-3", isPreview && "oms-html-preview-block")}>
      <div className="absolute -top-9 right-0 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        {isPreview && (
          <ToolbarButton
            label={showPreview ? "Hide preview" : "Show preview"}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </ToolbarButton>
        )}
        {isPreview && (
          <ToolbarButton label={showSource ? "Hide source" : "Show source"} onClick={() => setShowSource((v) => !v)}>
            <Code2 className="h-3.5 w-3.5" />
          </ToolbarButton>
        )}
        <ToolbarButton label="Copy" onClick={copyCode}>
          <Copy className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted">{lang || "plain"}</span>
      </div>

      {isPreview && showPreview && (
        <div className="overflow-hidden rounded-lg border border-border">
          <iframe
            title="HTML preview"
            sandbox=""
            srcDoc={buildHtmlPreviewSrcDoc(code)}
            className="block min-h-[120px] w-full border-0 bg-bg"
            style={{ height: "min(420px, 50vh)" }}
          />
        </div>
      )}

      {showSource && (
        <pre
          className={cn(
            "overflow-x-auto rounded-lg border border-border bg-code-bg p-3 text-sm",
            isPreview && showPreview && "mt-2",
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
