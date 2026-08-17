"use client";

import { useEffect, useState } from "react";
import { api, getActiveSpace } from "@/lib/api";
import type { AssetKind, ResolvedAsset } from "@/lib/types";

/**
 * Images and video embedded in notes.
 *
 * The bytes live in a private bucket, so a note body stores `oms-asset:<id>`
 * and never a URL that would grant access on its own. This module trades those
 * ids for short-lived signed URLs and caches them, so scrolling a note full of
 * screenshots doesn't re-sign the same objects over and over.
 */

export const ASSET_URI_PREFIX = "oms-asset:";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Renew this long before the signed URL actually dies, so an image that's been
 *  on screen for an hour swaps to a fresh URL before it can 400. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Requests inside this window collapse into one round trip — a note routinely
 *  mounts several media blocks in the same tick. */
const BATCH_WINDOW_MS = 16;

export function assetUri(id: string): string {
  return `${ASSET_URI_PREFIX}${id}`;
}

/** The asset id behind a `src`, or null when it's an ordinary URL. */
export function assetIdFromUri(src: string | null | undefined): string | null {
  if (!src) return null;
  const trimmed = src.trim();
  if (!trimmed.toLowerCase().startsWith(ASSET_URI_PREFIX)) return null;
  const id = trimmed.slice(ASSET_URI_PREFIX.length).trim();
  return UUID_RE.test(id) ? id : null;
}

// Keyed by space so switching brains can never show another space's URL.
const cache = new Map<string, ResolvedAsset>();
const inflight = new Map<string, Promise<ResolvedAsset | null>>();

function cacheKey(id: string): string {
  return `${getActiveSpace() ?? "self"}:${id}`;
}

function cached(id: string): ResolvedAsset | null {
  const key = cacheKey(id);
  const asset = cache.get(key);
  if (!asset) return null;
  if (asset.expiresAt - REFRESH_MARGIN_MS <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return asset;
}

/** Drop every signed URL — call when the active space changes or on sign-out. */
export function clearAssetCache(): void {
  cache.clear();
}

/** Seed the cache with a URL the server already handed us (e.g. right after an
 *  upload), so the freshly inserted block renders without a second round trip. */
export function primeAsset(asset: ResolvedAsset): void {
  cache.set(cacheKey(asset.id), asset);
}

let batch: Set<string> = new Set();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let batchWaiters: Array<(failed: boolean) => void> = [];

async function sessionToken(): Promise<string | null> {
  try {
    const { supabase } = await import("@/lib/supabaseClient");
    return (await supabase.auth.getSession()).data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function flushBatch(): Promise<void> {
  const ids = [...batch];
  const waiters = batchWaiters;
  batch = new Set();
  batchTimer = null;
  batchWaiters = [];

  let failed = false;
  try {
    const token = await sessionToken();
    if (!token) throw new Error("no session");
    const { assets } = await api.resolveAssets(token, ids);
    for (const asset of assets) cache.set(cacheKey(asset.id), asset);
  } catch {
    // A blip must not be mistaken for a deleted asset — the caller retries.
    failed = true;
  }
  // Ids the server answered without is a genuine miss (deleted, or another
  // space's), and `resolveAsset` resolves those to null.
  for (const done of waiters) done(failed);
}

/**
 * Resolve one asset id to a signed URL, batching concurrent callers.
 * Resolves to null when the asset genuinely isn't there; rejects when the
 * lookup itself failed, so a network blip stays retryable.
 */
export function resolveAsset(id: string): Promise<ResolvedAsset | null> {
  const hit = cached(id);
  if (hit) return Promise.resolve(hit);

  const key = cacheKey(id);
  const existing = inflight.get(key);
  if (existing) return existing;

  const pending = new Promise<ResolvedAsset | null>((resolve, reject) => {
    batch.add(id);
    batchWaiters.push((failed) => {
      if (failed) reject(new Error("could not load media"));
      else resolve(cached(id));
    });
    if (!batchTimer) batchTimer = setTimeout(() => void flushBatch(), BATCH_WINDOW_MS);
  }).finally(() => inflight.delete(key));

  inflight.set(key, pending);
  return pending;
}

export type AssetSrc = {
  /** URL to hand to <img>/<video>, or null while resolving or when gone. */
  url: string | null;
  loading: boolean;
  /** The asset no longer exists, or isn't readable in this space. */
  missing: boolean;
  width: number | null;
  height: number | null;
};

/**
 * Turn a media block's `src` into something a browser can load. Plain URLs pass
 * through untouched; `oms-asset:` references resolve to a signed URL and
 * re-resolve before that URL expires.
 */
export function useAssetSrc(src: string | null | undefined): AssetSrc {
  const id = assetIdFromUri(src);
  const plain = id ? null : (src?.trim() || null);
  const [resolved, setResolved] = useState<ResolvedAsset | null>(() => (id ? cached(id) : null));
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!id) {
      setResolved(null);
      setMissing(false);
      return;
    }
    let active = true;
    let renewTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const load = () => {
      resolveAsset(id)
        .then((asset) => {
          if (!active) return;
          attempt = 0;
          setResolved(asset);
          setMissing(asset === null);
          if (!asset) return;
          // Re-sign shortly before expiry so a long-open note keeps working.
          const delay = Math.max(asset.expiresAt - REFRESH_MARGIN_MS - Date.now(), 30_000);
          renewTimer = setTimeout(load, delay);
        })
        .catch(() => {
          // The lookup failed rather than the asset being gone: back off and
          // try again instead of showing a permanent "unavailable".
          if (!active) return;
          attempt += 1;
          if (attempt > 4) {
            setMissing(true);
            return;
          }
          renewTimer = setTimeout(load, 1000 * 2 ** (attempt - 1));
        });
    };
    load();

    return () => {
      active = false;
      if (renewTimer) clearTimeout(renewTimer);
    };
  }, [id]);

  if (!id) {
    return { url: plain, loading: false, missing: false, width: null, height: null };
  }
  return {
    url: resolved?.url ?? null,
    loading: !resolved && !missing,
    missing,
    width: resolved?.width ?? null,
    height: resolved?.height ?? null,
  };
}

// ── Upload ───────────────────────────────────────────────────────────────────

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];
export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const ACCEPTED_MEDIA_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES];

/** What the editor's drag/paste upload accepts — deliberately narrower than
 *  `AssetKind`: interactive HTML only enters through the MCP `add_media`. */
export function mediaKind(file: File): "image" | "video" | null {
  const type = file.type.toLowerCase();
  if (ACCEPTED_IMAGE_TYPES.includes(type)) return "image";
  if (ACCEPTED_VIDEO_TYPES.includes(type)) return "video";
  return null;
}

/** Best-effort intrinsic size, so the block can reserve space before the signed
 *  URL lands. Never blocks the upload: any failure just uploads without it. */
function probeDimensions(file: File, kind: AssetKind): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const done = (value: { width: number; height: number } | null) => {
      URL.revokeObjectURL(objectUrl);
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 4000);

    if (kind === "image") {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done(null);
      img.src = objectUrl;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => done({ width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => done(null);
    video.src = objectUrl;
  });
}

export interface UploadedAsset {
  id: string;
  /** What to write into the markdown `src:` field. */
  uri: string;
  kind: AssetKind;
  url: string | null;
}

export async function uploadNoteAsset(file: File, opts?: { path?: string | null }): Promise<UploadedAsset> {
  const kind = mediaKind(file);
  if (!kind) throw new Error(`${file.type || "That file type"} can't be embedded in a note`);

  const token = await sessionToken();
  if (!token) throw new Error("Your session expired — sign in again to upload");

  const dims = await probeDimensions(file, kind);
  const { asset, url, expiresAt } = await api.uploadAsset(token, file, {
    path: opts?.path ?? null,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
  });

  if (url && expiresAt) {
    primeAsset({
      id: asset.id,
      url,
      mime: asset.mime,
      kind: asset.kind,
      width: asset.width,
      height: asset.height,
      expiresAt,
    });
  }
  return { id: asset.id, uri: assetUri(asset.id), kind: asset.kind, url };
}

/** Media files out of a paste or drop, ignoring anything we can't embed. */
export function mediaFilesFrom(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return [...list].filter((f) => mediaKind(f) !== null);
}
