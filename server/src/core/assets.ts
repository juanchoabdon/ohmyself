import { randomUUID } from "node:crypto";
import { assetBucket, serviceClient } from "./supabase.js";
import { BadRequestError, BrainError, NotFoundError } from "./errors.js";

/**
 * Images and video embedded in notes.
 *
 * The bytes live in a private bucket, so a note body can never carry a URL that
 * grants access on its own. Markdown stores `oms-asset:<id>` and the renderer
 * trades that id for a short-lived signed URL, re-checking space membership on
 * every resolve. That keeps a note's attachments exactly as private as the note
 * — and keeps the markdown portable, since the reference never expires.
 */

/** Prefix that marks a `src:` as an uploaded asset rather than an external URL. */
export const ASSET_URI_PREFIX = "oms-asset:";

/** How long a resolved URL stays valid. Long enough to read a note without
 *  re-fetching, short enough that a leaked URL dies quickly. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Uploadable types → file extension. Anything outside this map is refused: the
 *  bucket is served back to browsers, so SVG (scriptable) and arbitrary
 *  documents stay out. */
const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Uploads are buffered whole in memory by the request handler, so this is
 *  bounded by container memory rather than by storage. Comfortably covers a
 *  screen recording; anything longer belongs on Loom/YouTube via `:::embed`. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type AssetKind = "image" | "video";

export interface NoteAsset {
  id: string;
  spaceId: string;
  path: string | null;
  mime: string;
  kind: AssetKind;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  createdAt: string;
}

export interface CreateAssetInput {
  spaceId: string;
  /** Note the asset is being inserted into, when known. Provenance only. */
  path?: string | null;
  mime: string;
  bytes: Uint8Array;
  width?: number | null;
  height?: number | null;
  originalName?: string | null;
  createdBy: string;
}

interface AssetRow {
  id: string;
  space_id: string;
  path: string | null;
  storage_key: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  original_name: string | null;
  created_at: string;
}

function mapAsset(row: AssetRow): NoteAsset {
  return {
    id: row.id,
    spaceId: row.space_id,
    path: row.path,
    mime: row.mime,
    kind: kindFor(row.mime),
    sizeBytes: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    originalName: row.original_name,
    createdAt: row.created_at,
  };
}

function kindFor(mime: string): AssetKind {
  return mime.startsWith("video/") ? "video" : "image";
}

/** Validate a content type and size, returning the extension to store under. */
export function checkUploadable(mime: string, sizeBytes: number): { ext: string; kind: AssetKind } {
  const normalized = mime.toLowerCase().split(";")[0]!.trim();
  const imageExt = IMAGE_TYPES[normalized];
  if (imageExt) {
    if (sizeBytes > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`images must be under ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
    }
    return { ext: imageExt, kind: "image" };
  }
  const videoExt = VIDEO_TYPES[normalized];
  if (videoExt) {
    if (sizeBytes > MAX_VIDEO_BYTES) {
      throw new BadRequestError(`video must be under ${MAX_VIDEO_BYTES / (1024 * 1024)} MB`);
    }
    return { ext: videoExt, kind: "video" };
  }
  throw new BadRequestError(
    `unsupported file type "${normalized}" — images (PNG, JPEG, WEBP, GIF, AVIF) and video (MP4, WEBM, MOV) only`,
  );
}

/** Strip the `oms-asset:` prefix from a `src`, or null when it's a plain URL. */
export function assetIdFromUri(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed.toLowerCase().startsWith(ASSET_URI_PREFIX)) return null;
  const id = trimmed.slice(ASSET_URI_PREFIX.length).trim();
  return UUID_RE.test(id) ? id : null;
}

export function assetUri(id: string): string {
  return `${ASSET_URI_PREFIX}${id}`;
}

/** Accept either form an agent might echo back: `oms-asset:<id>` copied out of
 *  a note body, or the bare id from a previous tool result. */
export function parseAssetRef(ref: string): string {
  const fromUri = assetIdFromUri(ref);
  if (fromUri) return fromUri;
  const bare = ref.trim();
  if (UUID_RE.test(bare)) return bare;
  throw new BadRequestError(`'${ref}' is not an asset reference — expected an id or oms-asset:<id>`);
}

/** Every asset referenced by a note body, in order of appearance. */
export function assetRefsInBody(body: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(`${ASSET_URI_PREFIX}([0-9a-f-]{36})`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const id = m[1]!;
    if (UUID_RE.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export async function createAsset(input: CreateAssetInput): Promise<NoteAsset> {
  const mime = input.mime.toLowerCase().split(";")[0]!.trim();
  const { ext } = checkUploadable(mime, input.bytes.byteLength);
  if (input.bytes.byteLength === 0) throw new BadRequestError("empty file");

  // The web client measures images before uploading; an agent has no way to.
  let { width, height } = input;
  if (!width && !height && mime in IMAGE_TYPES) {
    try {
      const { default: sharp } = await import("sharp");
      const meta = await sharp(input.bytes).metadata();
      // A rotated JPEG reports its pre-rotation dimensions.
      const swap = typeof meta.orientation === "number" && meta.orientation >= 5;
      width = swap ? meta.height : meta.width;
      height = swap ? meta.width : meta.height;
    } catch {
      /* dimensions are a nicety, not a reason to reject the upload */
    }
  }

  const sb = serviceClient();
  const id = randomUUID();
  const key = `${input.spaceId}/${id}.${ext}`;

  const { error: uploadError } = await sb.storage
    .from(assetBucket())
    .upload(key, input.bytes, { contentType: mime, upsert: false });
  if (uploadError) throw new BrainError(`asset upload failed: ${uploadError.message}`, 502);

  const { data, error } = await sb
    .from("note_assets")
    .insert({
      id,
      space_id: input.spaceId,
      path: input.path ?? null,
      storage_key: key,
      mime,
      size_bytes: input.bytes.byteLength,
      width: width ?? null,
      height: height ?? null,
      original_name: input.originalName?.slice(0, 200) ?? null,
      created_by: input.createdBy,
    })
    .select("id, space_id, path, storage_key, mime, size_bytes, width, height, original_name, created_at")
    .single();
  if (error || !data) {
    // Without a row the object is unreachable — don't leave it billing storage.
    await sb.storage.from(assetBucket()).remove([key]);
    throw new BrainError(`asset insert failed: ${error?.message}`, 502);
  }

  return mapAsset(data as AssetRow);
}

export interface ResolvedAsset {
  id: string;
  url: string;
  mime: string;
  kind: AssetKind;
  width: number | null;
  height: number | null;
  /** Epoch ms after which `url` stops working. */
  expiresAt: number;
}

/**
 * Trade asset ids for signed URLs, dropping any id that doesn't belong to
 * `spaceId`. Batched because a note routinely embeds several images and a
 * request per image would make the read path crawl.
 */
export async function resolveAssets(spaceId: string, ids: string[]): Promise<ResolvedAsset[]> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))].slice(0, 200);
  if (unique.length === 0) return [];

  const sb = serviceClient();
  const { data, error } = await sb
    .from("note_assets")
    .select("id, space_id, path, storage_key, mime, size_bytes, width, height, original_name, created_at")
    .eq("space_id", spaceId)
    .in("id", unique);
  if (error) throw new BrainError(`asset lookup failed: ${error.message}`, 502);

  const rows = (data ?? []) as AssetRow[];
  if (rows.length === 0) return [];

  const { data: signed, error: signError } = await sb.storage
    .from(assetBucket())
    .createSignedUrls(rows.map((r) => r.storage_key), SIGNED_URL_TTL_SECONDS);
  if (signError) throw new BrainError(`asset sign failed: ${signError.message}`, 502);

  const urlByKey = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.signedUrl && entry.path) urlByKey.set(entry.path, entry.signedUrl);
  }

  const expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
  return rows
    .map((row) => {
      const url = urlByKey.get(row.storage_key);
      if (!url) return null;
      return {
        id: row.id,
        url,
        mime: row.mime,
        kind: kindFor(row.mime),
        width: row.width,
        height: row.height,
        expiresAt,
      } satisfies ResolvedAsset;
    })
    .filter((a): a is ResolvedAsset => a !== null);
}

export interface ListAssetsOptions {
  /** Only assets first inserted into this note. */
  path?: string;
  limit?: number;
}

export async function listAssets(spaceId: string, opts: ListAssetsOptions = {}): Promise<NoteAsset[]> {
  const sb = serviceClient();
  let query = sb
    .from("note_assets")
    .select("id, space_id, path, storage_key, mime, size_bytes, width, height, original_name, created_at")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  if (opts.path) query = query.eq("path", opts.path.trim().replace(/^\/+/, ""));

  const { data, error } = await query;
  if (error) throw new BrainError(`asset list failed: ${error.message}`, 502);
  return ((data ?? []) as AssetRow[]).map(mapAsset);
}

/** Raw stored bytes for an asset. */
export async function readAssetBytes(spaceId: string, id: string): Promise<{ asset: NoteAsset; bytes: Buffer }> {
  const row = await getAssetRow(spaceId, id);
  const sb = serviceClient();
  const { data, error } = await sb.storage.from(assetBucket()).download(row.storage_key);
  if (error || !data) throw new NotFoundError("asset bytes are missing");
  return { asset: mapAsset(row), bytes: Buffer.from(await data.arrayBuffer()) };
}

/**
 * Longest edge of the copy handed to a model. 1568px is where Claude stops
 * gaining detail, so anything larger is bytes on the wire for no accuracy.
 */
const AGENT_IMAGE_MAX_EDGE = 1568;

function agentDerivativeKey(spaceId: string, id: string): string {
  return `${spaceId}/agent/${id}.webp`;
}

export interface AgentImage {
  base64: string;
  mime: string;
  /** True when the model is seeing a downscaled copy, not the original. */
  downscaled: boolean;
}

/**
 * An image sized for a model's vision input.
 *
 * Tool results travel as base64 inside JSON, so handing back an 8 MB original
 * would cost megabytes per call and buy no accuracy. The downscaled copy is
 * cached in the bucket beside the original, since the same screenshot tends to
 * be read many times across a conversation.
 */
export async function agentImage(spaceId: string, id: string): Promise<AgentImage> {
  const asset = await getAsset(spaceId, id);
  if (asset.kind !== "image") {
    throw new BadRequestError("only images can be returned to a model — use the signed url for video");
  }

  const sb = serviceClient();
  const derivativeKey = agentDerivativeKey(spaceId, id);
  const cached = await sb.storage.from(assetBucket()).download(derivativeKey);
  if (cached.data) {
    return {
      base64: Buffer.from(await cached.data.arrayBuffer()).toString("base64"),
      mime: "image/webp",
      downscaled: true,
    };
  }

  const { bytes } = await readAssetBytes(spaceId, id);
  const { default: sharp } = await import("sharp");
  let rendered: Buffer;
  try {
    rendered = await sharp(bytes)
      // Honor EXIF orientation — a phone screenshot arrives sideways otherwise.
      .rotate()
      .resize({
        width: AGENT_IMAGE_MAX_EDGE,
        height: AGENT_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    // A format sharp can't decode still beats nothing if it's small enough.
    if (bytes.byteLength <= 4 * 1024 * 1024) {
      return { base64: bytes.toString("base64"), mime: asset.mime, downscaled: false };
    }
    throw new BadRequestError("could not prepare this image for a model");
  }

  await sb.storage
    .from(assetBucket())
    .upload(derivativeKey, rendered, { contentType: "image/webp", upsert: true })
    .catch(() => {
      /* cache miss next time is fine */
    });

  return { base64: rendered.toString("base64"), mime: "image/webp", downscaled: true };
}

/** The markdown block that embeds `asset` in a note body. */
export function mediaBlockFor(asset: NoteAsset, opts?: { alt?: string; caption?: string }): string {
  const src = assetUri(asset.id);
  if (asset.kind === "video") {
    const title = opts?.caption || opts?.alt || asset.originalName || "Video";
    return `:::video\nsrc: ${src}\ntitle: ${title}\n:::`;
  }
  const lines = [`src: ${src}`];
  const alt = opts?.alt || asset.originalName;
  if (alt) lines.push(`alt: ${alt}`);
  if (opts?.caption) lines.push(`caption: ${opts.caption}`);
  return `:::image\n${lines.join("\n")}\n:::`;
}

async function getAssetRow(spaceId: string, id: string): Promise<AssetRow> {
  if (!UUID_RE.test(id)) throw new NotFoundError("asset not found");
  const sb = serviceClient();
  const { data, error } = await sb
    .from("note_assets")
    .select("id, space_id, path, storage_key, mime, size_bytes, width, height, original_name, created_at")
    .eq("space_id", spaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new BrainError(`asset lookup failed: ${error.message}`, 502);
  if (!data) throw new NotFoundError("asset not found");
  return data as AssetRow;
}

export async function getAsset(spaceId: string, id: string): Promise<NoteAsset> {
  return mapAsset(await getAssetRow(spaceId, id));
}
