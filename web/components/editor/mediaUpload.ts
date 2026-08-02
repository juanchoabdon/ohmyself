import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { mediaFilesFrom, mediaKind, uploadNoteAsset } from "@/lib/assets";

/**
 * Dropping or pasting an image/video into a note.
 *
 * The block appears immediately with a local preview and finishes as an
 * `oms-asset:` reference once the bytes land. The in-flight state is held in
 * this module rather than in the node's attributes, because attributes are
 * serialized into the markdown (and synced over Yjs) — a `blob:` URL must never
 * reach either. The node only carries an opaque `pending` key.
 */

type PendingUpload = {
  previewUrl: string;
  name: string;
  kind: "image" | "video";
  /** Kept so a failed upload can be retried without re-picking the file. */
  file: File;
  notePath: string | null;
  error?: string;
};

const pending = new Map<string, PendingUpload>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeToUploads(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pendingUpload(key: string | null | undefined): PendingUpload | null {
  return key ? pending.get(key) ?? null : null;
}

function releasePending(key: string): void {
  const entry = pending.get(key);
  if (!entry) return;
  URL.revokeObjectURL(entry.previewUrl);
  pending.delete(key);
  notify();
}

/**
 * Find the media node carrying `key` and update it. Scanning beats holding a
 * position across the upload: by the time the bytes land the user may have
 * typed anywhere in the document.
 */
function patchPendingNode(editor: Editor, key: string, attrs: Record<string, unknown>): boolean {
  if (editor.isDestroyed) return false;
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.attrs?.pending === key) found = pos;
    return found < 0;
  });
  if (found < 0) return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(found, undefined, {
    ...editor.state.doc.nodeAt(found)?.attrs,
    ...attrs,
  }));
  return true;
}

async function runUpload(editor: Editor, key: string): Promise<void> {
  const entry = pending.get(key);
  if (!entry) return;
  if (entry.error) {
    pending.set(key, { ...entry, error: undefined });
    notify();
  }

  try {
    const asset = await uploadNoteAsset(entry.file, { path: entry.notePath });
    // Set the real src and drop `pending` in one step, so the block never
    // flashes empty between the two updates.
    patchPendingNode(editor, key, { src: asset.uri, pending: null });
    // Releases the preview whether or not the node survived the upload.
    releasePending(key);
  } catch (e) {
    const current = pending.get(key);
    if (!current) return;
    pending.set(key, { ...current, error: e instanceof Error ? e.message : "Upload failed" });
    notify();
  }
}

/** Insert a media block for `file` and upload it in the background. */
export async function insertUploadedMedia(
  editor: Editor,
  file: File,
  notePath: string | null,
): Promise<void> {
  const kind = mediaKind(file);
  if (!kind) return;

  const key = `up_${Math.random().toString(36).slice(2)}`;
  pending.set(key, {
    previewUrl: URL.createObjectURL(file),
    name: file.name,
    kind,
    file,
    notePath,
  });
  notify();

  editor
    .chain()
    .focus()
    .insertContent(
      kind === "image"
        ? { type: "omsImage", attrs: { src: "", alt: file.name, caption: "", pending: key } }
        : { type: "omsVideo", attrs: { src: "", title: file.name, pending: key } },
    )
    .run();

  await runUpload(editor, key);
}

/** Re-run a failed upload for a block that's still in the document. */
export function retryUpload(editor: Editor, key: string): void {
  void runUpload(editor, key);
}

export async function insertUploadedMediaFiles(
  editor: Editor,
  files: File[],
  notePath: string | null,
): Promise<void> {
  for (const file of files) await insertUploadedMedia(editor, file, notePath);
}

export interface MediaUploadOptions {
  /** Note the assets belong to — recorded for provenance. */
  notePath: string | null;
}

/** The open note's path, for node views that only have the editor at hand. */
export function notePathFromEditor(editor: Editor): string | null {
  const ext = editor.extensionManager.extensions.find((e) => e.name === "mediaUpload");
  return (ext?.options as MediaUploadOptions | undefined)?.notePath ?? null;
}

export const MediaUpload = Extension.create<MediaUploadOptions>({
  name: "mediaUpload",

  addOptions() {
    return { notePath: null };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const notePath = () => this.options.notePath;

    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const files = mediaFilesFrom(event.clipboardData?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            void insertUploadedMediaFiles(editor, files, notePath());
            return true;
          },
          handleDrop(_view, event) {
            const dragEvent = event as DragEvent;
            const files = mediaFilesFrom(dragEvent.dataTransfer?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            void insertUploadedMediaFiles(editor, files, notePath());
            return true;
          },
        },
      }),
    ];
  },
});
