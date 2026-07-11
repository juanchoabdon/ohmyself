/**
 * Split a note body into meaningful, section-aware chunks for embedding.
 *
 * Rationale (Brain Retrieval spec, Layer 1 / Chunking): embeddings should be
 * persisted per meaningful chunk rather than per whole note or title+excerpt.
 * Chunks stay large enough to preserve meaning, with modest overlap between
 * adjacent chunks, and each remembers the nearest heading so retrieval can
 * report where in the note the evidence came from.
 */

export interface NoteChunk {
  /** 0-based position within the note, in document order. */
  pos: number;
  /** Nearest markdown heading above this chunk ("" for the preamble). */
  section: string;
  /** Raw chunk text (kept for excerpt/display). */
  content: string;
}

export interface ChunkOptions {
  /** Target chunk size in characters (soft cap). */
  maxChars?: number;
  /** Overlap in characters carried from the previous chunk. */
  overlapChars?: number;
  /** Minimum chars for a standalone chunk before it's merged forward. */
  minChars?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  maxChars: 1400,
  overlapChars: 180,
  minChars: 80,
};

interface Section {
  heading: string;
  body: string;
}

/** Split markdown into (heading, body) sections by ATX headings (#..######). */
function splitSections(body: string): Section[] {
  const lines = body.split(/\r?\n/);
  const sections: Section[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ heading, body: text });
    buf = [];
  };
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence ? /^(#{1,6})\s+(.*)$/.exec(line) : null;
    if (m) {
      flush();
      heading = m[2]!.trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/** Greedily pack paragraphs of a section into chunks under maxChars, with a
 *  soft overlap carried between adjacent chunks so meaning isn't cut mid-idea. */
function packSection(text: string, opts: Required<ChunkOptions>): string[] {
  if (text.length <= opts.maxChars) return [text];
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const para of paras) {
    // A single oversized paragraph: hard-split on sentence-ish boundaries.
    if (para.length > opts.maxChars) {
      if (cur) {
        chunks.push(cur);
        cur = "";
      }
      const pieces = para.match(new RegExp(`[\\s\\S]{1,${opts.maxChars}}`, "g")) ?? [para];
      for (const piece of pieces) chunks.push(piece.trim());
      continue;
    }
    if (cur && cur.length + para.length + 2 > opts.maxChars) {
      chunks.push(cur);
      const tail = cur.slice(Math.max(0, cur.length - opts.overlapChars));
      cur = `${tail}\n\n${para}`;
    } else {
      cur = cur ? `${cur}\n\n${para}` : para;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/**
 * Chunk a note body. Returns an ordered list of chunks with their section
 * heading. Tiny trailing chunks are merged back so we don't embed scraps.
 */
export function chunkNote(body: string, options?: ChunkOptions): NoteChunk[] {
  const opts = { ...DEFAULTS, ...(options ?? {}) };
  const clean = (body ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const out: NoteChunk[] = [];
  for (const sec of splitSections(clean)) {
    const pieces = packSection(sec.body, opts);
    for (const piece of pieces) {
      const content = piece.trim();
      if (!content) continue;
      const last = out[out.length - 1];
      // Merge a runt chunk into the previous one from the same section.
      if (last && content.length < opts.minChars && last.section === sec.heading) {
        last.content = `${last.content}\n\n${content}`;
      } else {
        out.push({ pos: 0, section: sec.heading, content });
      }
    }
  }
  return out.map((c, i) => ({ ...c, pos: i }));
}

/** Text actually sent to the embedder: title + section give the vector topical
 *  anchoring even when the chunk body alone is ambiguous. */
export function embedTextForChunk(title: string, chunk: NoteChunk): string {
  const head = [title.trim(), chunk.section.trim()].filter(Boolean).join(" — ");
  return head ? `${head}\n\n${chunk.content}` : chunk.content;
}
