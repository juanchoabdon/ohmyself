"use client";

import { useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { X, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";

export function OmsImageView({ node, selected, updateAttributes }: NodeViewProps) {
  const src = (node.attrs.src as string) || "";
  const alt = (node.attrs.alt as string) || "";
  const caption = (node.attrs.caption as string) || "";
  const [zoomed, setZoomed] = useState(false);

  return (
    <NodeViewWrapper className={cn("oms-image my-4", selected && "oms-image--selected")}>
      <figure className="oms-image__figure">
        {src ? (
          <button
            type="button"
            className="oms-image__zoom group relative block w-full overflow-hidden rounded-lg border border-border"
            onClick={() => setZoomed(true)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="block max-h-[420px] w-full object-contain bg-surface" />
            <span className="absolute right-2 top-2 rounded-md border border-border bg-surface/90 p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
              <ZoomIn className="h-4 w-4 text-muted" />
            </span>
          </button>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-bg px-4 py-8 text-center text-sm text-muted">
            Add image URL in source mode: :::image block
          </div>
        )}
        {selected && (
          <div className="mt-2 space-y-2">
            <input
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
              value={src}
              placeholder="src: https://…"
              onChange={(e) => updateAttributes({ src: e.target.value })}
            />
            <input
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
              value={alt}
              placeholder="alt text"
              onChange={(e) => updateAttributes({ alt: e.target.value })}
            />
            <input
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
              value={caption}
              placeholder="caption (optional)"
              onChange={(e) => updateAttributes({ caption: e.target.value })}
            />
          </div>
        )}
        {caption && !selected && (
          <figcaption className="mt-2 text-center text-xs text-muted">{caption}</figcaption>
        )}
      </figure>

      {zoomed && src && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/70 p-4"
          role="dialog"
          onClick={() => setZoomed(false)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-lg border border-border bg-surface p-2"
            onClick={() => setZoomed(false)}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </NodeViewWrapper>
  );
}

function youtubeEmbedUrl(src: string): string | null {
  try {
    const u = new URL(src);
    if (u.hostname.includes("youtu.be")) {
      return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (u.hostname.includes("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function OmsVideoView({ node, selected, updateAttributes }: NodeViewProps) {
  const src = (node.attrs.src as string) || "";
  const title = (node.attrs.title as string) || "Video";
  const embed = youtubeEmbedUrl(src);

  return (
    <NodeViewWrapper className={cn("oms-video my-4", selected && "oms-video--selected")}>
      {selected && (
        <div className="mb-2 space-y-2">
          <input
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={src}
            placeholder="YouTube or Vimeo URL"
            onChange={(e) => updateAttributes({ src: e.target.value })}
          />
          <input
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={title}
            placeholder="Title"
            onChange={(e) => updateAttributes({ title: e.target.value })}
          />
        </div>
      )}
      {embed ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <iframe
            title={title}
            src={embed}
            className="aspect-video w-full border-0 bg-bg"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-bg px-4 py-8 text-center text-sm text-muted">
          Paste a YouTube or Vimeo URL
        </div>
      )}
      {title && <p className="mt-2 text-xs text-muted">{title}</p>}
    </NodeViewWrapper>
  );
}

export function OmsEmbedView({ node, selected, updateAttributes }: NodeViewProps) {
  const url = (node.attrs.url as string) || "";
  const height = Number(node.attrs.height) || 420;
  const title = (node.attrs.title as string) || "Embed";

  return (
    <NodeViewWrapper className={cn("oms-embed my-4", selected && "oms-embed--selected")}>
      {selected && (
        <div className="mb-2 space-y-2">
          <input
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={url}
            placeholder="Embed URL (Figma, Loom, …)"
            onChange={(e) => updateAttributes({ url: e.target.value })}
          />
          <input
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={String(height)}
            placeholder="height px"
            onChange={(e) => updateAttributes({ height: Number(e.target.value) || 420 })}
          />
        </div>
      )}
      {url ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <iframe
            title={title}
            src={url}
            sandbox="allow-scripts allow-same-origin allow-popups"
            className="w-full border-0 bg-bg"
            style={{ height: `${Math.min(height, 720)}px` }}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-bg px-4 py-8 text-center text-sm text-muted">
          Paste an embed URL
        </div>
      )}
    </NodeViewWrapper>
  );
}
