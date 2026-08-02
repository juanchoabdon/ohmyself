"use client";

import { useRef, useSyncExternalStore } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { AlertTriangle, Loader2, RotateCw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCEPTED_IMAGE_TYPES, ACCEPTED_VIDEO_TYPES, assetIdFromUri } from "@/lib/assets";
import { BlockDeleteButton } from "./BlockDeleteButton";
import { deleteRichBlockAt } from "./markdownRichContent";
import { AssetImage, AssetVideo, EmbedFrame, MediaPlaceholder } from "./MediaRender";
import {
  insertUploadedMedia,
  notePathFromEditor,
  pendingUpload,
  retryUpload,
  subscribeToUploads,
} from "./mediaUpload";

function usePendingUpload(key: string | null) {
  return useSyncExternalStore(
    subscribeToUploads,
    () => pendingUpload(key),
    () => null,
  );
}

/** Local preview shown while the bytes are still going up. */
function UploadingPreview({
  previewUrl,
  kind,
  name,
  error,
  onRetry,
}: {
  previewUrl: string;
  kind: "image" | "video";
  name: string;
  error?: string;
  onRetry: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt={name}
          className={cn("block max-h-[420px] w-full bg-surface object-contain", !error && "opacity-60")}
        />
      ) : (
        <video src={previewUrl} className={cn("max-h-[420px] w-full bg-ink/90", !error && "opacity-60")} muted />
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-surface/95 px-3 py-2 text-xs">
        {error ? (
          <>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-red-500">{error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 font-medium text-ink hover:border-brand/40 hover:text-brand"
            >
              <RotateCw className="h-3 w-3" aria-hidden />
              Retry
            </button>
          </>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-hidden />
            <span className="text-muted">Uploading {name}…</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Empty-state chooser: upload a file, or point at a URL. */
function MediaChooser({
  accept,
  label,
  onPick,
}: {
  accept: string[];
  label: string;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <MediaPlaceholder>
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mx-auto flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-brand/40 hover:text-brand"
      >
        <Upload className="h-4 w-4" aria-hidden />
        {label}
      </button>
      <p className="mt-2 text-xs text-muted">or drop a file here, or paste a URL below</p>
    </MediaPlaceholder>
  );
}

export function OmsImageView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const src = (node.attrs.src as string) || "";
  const alt = (node.attrs.alt as string) || "";
  const caption = (node.attrs.caption as string) || "";
  const upload = usePendingUpload((node.attrs.pending as string) || null);
  const uploaded = assetIdFromUri(src) !== null;

  const removeBlock = () => {
    const pos = getPos();
    if (typeof pos === "number") deleteRichBlockAt(editor, pos);
  };

  return (
    <NodeViewWrapper className={cn("oms-image my-4", selected && "oms-image--selected")}>
      <figure className="oms-image__figure">
        <div className="mb-1 flex justify-end">
          <BlockDeleteButton label="Remove image" onClick={removeBlock} />
        </div>

        {upload ? (
          <UploadingPreview
            previewUrl={upload.previewUrl}
            kind={upload.kind}
            name={upload.name}
            error={upload.error}
            onRetry={() => retryUpload(editor, node.attrs.pending as string)}
          />
        ) : src ? (
          <AssetImage src={src} alt={alt} caption={selected ? undefined : caption} />
        ) : (
          <MediaChooser
            accept={ACCEPTED_IMAGE_TYPES}
            label="Upload image"
            onPick={(file) => {
              // Replace this empty block with the uploading one.
              removeBlock();
              void insertUploadedMedia(editor, file, notePathFromEditor(editor));
            }}
          />
        )}

        {selected && (
          <div className="mt-2 space-y-2">
            <input
              className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
              value={uploaded ? "" : src}
              placeholder={uploaded ? "Uploaded file" : "src: https://…"}
              disabled={uploaded}
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
      </figure>
    </NodeViewWrapper>
  );
}

export function OmsVideoView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const src = (node.attrs.src as string) || "";
  const title = (node.attrs.title as string) || "Video";
  const upload = usePendingUpload((node.attrs.pending as string) || null);
  const uploaded = assetIdFromUri(src) !== null;

  const removeBlock = () => {
    const pos = getPos();
    if (typeof pos === "number") deleteRichBlockAt(editor, pos);
  };

  return (
    <NodeViewWrapper className={cn("oms-video my-4", selected && "oms-video--selected")}>
      {selected && (
        <div className="mb-2 space-y-2">
          <input
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={uploaded ? "" : src}
            placeholder={uploaded ? "Uploaded file" : "YouTube, Vimeo, or video URL"}
            disabled={uploaded}
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

      <div className="mb-1 flex justify-end">
        <BlockDeleteButton label="Remove video" onClick={removeBlock} />
      </div>

      {upload ? (
        <UploadingPreview
          previewUrl={upload.previewUrl}
          kind={upload.kind}
          name={upload.name}
          error={upload.error}
          onRetry={() => retryUpload(editor, node.attrs.pending as string)}
        />
      ) : src ? (
        <AssetVideo src={src} title={title} />
      ) : (
        <MediaChooser
          accept={ACCEPTED_VIDEO_TYPES}
          label="Upload video"
          onPick={(file) => {
            removeBlock();
            void insertUploadedMedia(editor, file, notePathFromEditor(editor));
          }}
        />
      )}

      {title && !selected && <p className="mt-2 text-xs text-muted">{title}</p>}
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
        <EmbedFrame url={url} title={title} height={height} />
      ) : (
        <MediaPlaceholder>Paste an embed URL</MediaPlaceholder>
      )}
    </NodeViewWrapper>
  );
}
