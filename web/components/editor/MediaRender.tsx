"use client";

import { useState } from "react";
import { ImageOff, X, ZoomIn } from "lucide-react";
import { useAssetSrc } from "@/lib/assets";
import { cn } from "@/lib/utils";

/**
 * Presentational media, shared by the editor's node views and the read-only
 * renderer so a note looks the same whether or not you're editing it.
 *
 * Every `src` here goes through `useAssetSrc`: an uploaded asset arrives as
 * `oms-asset:<id>` and resolves to a short-lived signed URL, while an external
 * URL passes straight through.
 */

function MediaPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-bg px-4 py-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function AssetImage({
  src,
  alt,
  caption,
  className,
}: {
  src: string;
  alt?: string;
  caption?: string;
  className?: string;
}) {
  const { url, loading, missing, width, height } = useAssetSrc(src);
  const [zoomed, setZoomed] = useState(false);

  if (loading) {
    return (
      <div
        className="skeleton w-full rounded-lg"
        // Hold the real aspect ratio when we know it, so the page doesn't jump
        // when the image lands.
        style={{ aspectRatio: width && height ? `${width} / ${height}` : "16 / 9", maxHeight: 420 }}
        aria-hidden
      />
    );
  }

  if (missing || !url) {
    return (
      <MediaPlaceholder>
        <ImageOff className="mx-auto mb-2 h-5 w-5 opacity-60" aria-hidden />
        This image is no longer available.
      </MediaPlaceholder>
    );
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          "oms-image__zoom group relative block w-full overflow-hidden rounded-lg border border-border",
          className,
        )}
        onClick={() => setZoomed(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt ?? ""} className="block max-h-[420px] w-full bg-surface object-contain" />
        <span className="absolute right-2 top-2 rounded-md border border-border bg-surface/90 p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          <ZoomIn className="h-4 w-4 text-muted" />
        </span>
      </button>
      {caption ? <figcaption className="mt-2 text-center text-xs text-muted">{caption}</figcaption> : null}

      {zoomed && (
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
            src={url}
            alt={alt ?? ""}
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/** Player URL for the sites we embed rather than stream ourselves. */
export function providerEmbedUrl(src: string): string | null {
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

export function AssetVideo({ src, title }: { src: string; title?: string }) {
  const provider = providerEmbedUrl(src);
  // Hooks can't be skipped, so resolve unconditionally; a provider URL isn't an
  // asset reference and passes through untouched.
  const { url, loading, missing } = useAssetSrc(provider ? null : src);

  if (provider) {
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <iframe
          title={title || "Video"}
          src={provider}
          className="aspect-video w-full border-0 bg-bg"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  if (loading) {
    return <div className="skeleton aspect-video w-full rounded-lg" aria-hidden />;
  }

  if (missing || !url) {
    return <MediaPlaceholder>This video is no longer available.</MediaPlaceholder>;
  }

  return (
    <video
      src={url}
      title={title || undefined}
      controls
      playsInline
      preload="metadata"
      className="max-h-[480px] w-full rounded-lg border border-border bg-ink/90"
    />
  );
}

export function EmbedFrame({ url, title, height }: { url: string; title?: string; height: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <iframe
        title={title || "Embed"}
        src={url}
        sandbox="allow-scripts allow-same-origin allow-popups"
        className="w-full border-0 bg-bg"
        style={{ height: `${Math.min(height, 720)}px` }}
      />
    </div>
  );
}

export { MediaPlaceholder };
