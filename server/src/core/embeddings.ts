/**
 * Semantic embeddings for the Brain Map's "idea links".
 *
 * We embed a short text per note (title + excerpt only — never the full body,
 * to limit what leaves the server) with OpenAI's small embedding model, cache
 * vectors by content hash in-process, and derive fuzzy semantic edges between
 * notes that are topically close even when they aren't explicitly linked.
 *
 * Reuses the same OPENAI_API_KEY the transcript organizer already uses, so no
 * new provider is introduced.
 */

import { createHash } from "node:crypto";

const MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const apiKey = () => process.env.OPENAI_API_KEY ?? "";

/** Vector width of the configured embedding model. Must match the pgvector
 *  column dimension in the note_chunks migration (text-embedding-3-small: 1536). */
export const EMBED_DIM = Number(process.env.OPENAI_EMBED_DIM ?? "1536") || 1536;

const EMBED_TIMEOUT_MS = 20000;
const BATCH = 256;
const CACHE_MAX = 6000;

// Content-addressed cache (key = hash of model+text). Survives within a warm
// serverless instance, so repeated map opens in a session are essentially free.
const cache = new Map<string, number[]>();

export function embeddingsEnabled(): boolean {
  return Boolean(apiKey());
}

function keyOf(text: string): string {
  return createHash("sha256").update(`${MODEL}\u0000${text}`).digest("hex");
}

async function callOpenAI(inputs: string[]): Promise<number[][] | null> {
  const key = apiKey();
  if (!key) return null;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: inputs }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
    if (!data.data) return null;
    const out: number[][] = new Array(inputs.length);
    for (const d of data.data) out[d.index] = d.embedding;
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/** Embed texts, using the cache and only calling the API for cache misses. */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const keys = texts.map(keyOf);
  const result: (number[] | null)[] = texts.map((_, i) => cache.get(keys[i]!) ?? null);

  const missIdx: number[] = [];
  result.forEach((v, i) => {
    if (!v) missIdx.push(i);
  });

  for (let s = 0; s < missIdx.length; s += BATCH) {
    const idxSlice = missIdx.slice(s, s + BATCH);
    const vecs = await callOpenAI(idxSlice.map((i) => texts[i]!));
    if (!vecs) break; // soft-fail: leave the rest null
    vecs.forEach((v, j) => {
      const gi = idxSlice[j]!;
      result[gi] = v;
      cache.set(keys[gi]!, v);
    });
  }

  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }

  return result;
}

/** Embed a single query string. Returns null if embeddings are disabled or the
 *  provider call fails (callers fall back to lexical-only retrieval). */
export async function embedQuery(text: string): Promise<number[] | null> {
  const q = text.trim();
  if (!q) return null;
  const [vec] = await embedTexts([q]);
  return vec ?? null;
}

/** Format a vector for pgvector as a text literal ("[0.1,0.2,...]"). We pass the
 *  query embedding to the hybrid_search RPC as text and cast to `vector` in SQL,
 *  which is the most portable way through PostgREST. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SemanticEdge {
  a: string;
  b: string;
  score: number;
}

/**
 * Build undirected semantic edges: each note keeps its top-K most similar
 * neighbours above `min`. Pairs are deduped, strongest score wins.
 */
export function semanticEdges(
  items: { path: string; vec: number[] }[],
  opts?: { topK?: number; min?: number },
): SemanticEdge[] {
  const topK = opts?.topK ?? 3;
  const min = opts?.min ?? 0.42;
  const n = items.length;
  const perNode: { j: number; s: number }[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosine(items[i]!.vec, items[j]!.vec);
      if (s < min) continue;
      perNode[i]!.push({ j, s });
      perNode[j]!.push({ j: i, s });
    }
  }

  const edges = new Map<string, SemanticEdge>();
  for (let i = 0; i < n; i++) {
    perNode[i]!.sort((x, y) => y.s - x.s);
    for (const { j, s } of perNode[i]!.slice(0, topK)) {
      const pa = items[i]!.path;
      const pb = items[j]!.path;
      const [a, b] = pa < pb ? [pa, pb] : [pb, pa];
      const key = `${a}\u0000${b}`;
      const ex = edges.get(key);
      if (!ex || s > ex.score) edges.set(key, { a, b, score: Number(s.toFixed(3)) });
    }
  }
  return [...edges.values()];
}
