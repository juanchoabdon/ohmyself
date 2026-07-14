"use client";

import { buildHtmlPreviewSrcDoc, isHtmlPreviewLanguage } from "./htmlPreview";

export function HtmlPreviewFrame({ html, className }: { html: string; className?: string }) {
  return (
    <div className={`oms-html-preview-read overflow-hidden rounded-lg border border-border ${className ?? ""}`}>
      <iframe
        title="HTML preview"
        sandbox=""
        srcDoc={buildHtmlPreviewSrcDoc(html)}
        className="block min-h-[120px] w-full border-0 bg-bg"
        style={{ height: "min(420px, 50vh)" }}
      />
    </div>
  );
}

/** remark/rehype className like `language-html-preview` */
export function languageFromClassName(className?: string): string | null {
  const match = /language-([\w-]+)/.exec(className || "");
  return match?.[1]?.replace(/-/g, " ") ?? null;
}

export function isHtmlPreviewClassName(className?: string): boolean {
  return isHtmlPreviewLanguage(languageFromClassName(className));
}
