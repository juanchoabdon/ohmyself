/**
 * Backfill chunk embeddings for the hybrid-retrieval layer, across EVERY space
 * (all users' self spaces + all company spaces). Chunks each note's body from
 * note_index.content (already a full copy — no vault/storage reads needed),
 * embeds the chunks, and writes them to note_chunks.
 *
 * Idempotent + resumable: by default skips notes that already have embedded
 * chunks; pass --force to re-embed everything.
 *
 *   tsx src/scripts/backfill-embeddings.ts                 # all spaces
 *   tsx src/scripts/backfill-embeddings.ts --dry           # estimate only, no writes/embeds
 *   tsx src/scripts/backfill-embeddings.ts --space <id>    # a single space
 *   tsx src/scripts/backfill-embeddings.ts --force         # re-embed even if present
 *   tsx src/scripts/backfill-embeddings.ts --conc 6 --limit 100000
 */
import "../env.js";
import { chunkNote, embedTextForChunk } from "../core/chunker.js";
import { EMBED_DIM, embedTexts, embeddingsEnabled } from "../core/embeddings.js";
import { SupabaseIndex } from "../core/indexer/supabase.js";
import { serviceClient } from "../core/supabase.js";
import type { ChunkRecord, IndexRecord, Visibility } from "../core/types.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

interface NoteRow {
  path: string;
  note_id: string | null;
  title: string;
  type: string;
  visibility: Visibility;
  tags: string[] | null;
  created: string | null;
  updated: string | null;
  content: string;
}

const NOTE_SELECT =
  "path, note_id, title, type, visibility, tags, created, updated, content";

/** text-embedding-3-small is $0.02 / 1M tokens; tokens ≈ chars / 4. */
const USD_PER_MTOK = 0.02;

async function listSpaceIds(only?: string): Promise<string[]> {
  if (only) return [only];
  const sb = serviceClient();
  const ids: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("spaces")
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`list spaces failed: ${error.message}`);
    const batch = (data as { id: string }[] | null) ?? [];
    ids.push(...batch.map((r) => r.id));
    if (batch.length < PAGE) break;
  }
  return ids;
}

async function listNotes(spaceId: string, limit: number): Promise<NoteRow[]> {
  const sb = serviceClient();
  const rows: NoteRow[] = [];
  const PAGE = 500;
  for (let from = 0; rows.length < limit; from += PAGE) {
    const { data, error } = await sb
      .from("note_index")
      .select(NOTE_SELECT)
      .eq("space_id", spaceId)
      .order("path", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`list notes failed: ${error.message}`);
    const batch = (data as NoteRow[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows.slice(0, limit);
}

/** Paths that already have at least one embedded chunk (for resumable skips). */
async function embeddedPaths(spaceId: string): Promise<Set<string>> {
  const sb = serviceClient();
  const set = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("note_chunks")
      .select("path")
      .eq("space_id", spaceId)
      .not("embedding", "is", null)
      .order("path", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`list embedded chunks failed: ${error.message}`);
    const batch = (data as { path: string }[] | null) ?? [];
    for (const r of batch) set.add(r.path);
    if (batch.length < PAGE) break;
  }
  return set;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const dry = hasFlag("--dry");
  const force = hasFlag("--force");
  const only = argFor("--space");
  const limit = Number(argFor("--limit") ?? "1000000") || 1_000_000;
  const concurrency = Number(argFor("--conc") ?? "5") || 5;

  if (!dry && !embeddingsEnabled()) {
    throw new Error("OPENAI_API_KEY is not set — cannot embed. Use --dry to estimate only.");
  }

  const idx = new SupabaseIndex();
  const spaceIds = await listSpaceIds(only);
  console.log(
    `Backfill embeddings — spaces=${spaceIds.length} dim=${EMBED_DIM} dry=${dry} force=${force} conc=${concurrency}`,
  );

  const totals = { notes: 0, embeddedNotes: 0, skipped: 0, chunks: 0, chars: 0, errors: 0 };

  for (const spaceId of spaceIds) {
    const notes = await listNotes(spaceId, limit);
    const done = force ? new Set<string>() : await embeddedPaths(spaceId);
    const pending = notes.filter((n) => force || !done.has(n.path));
    totals.notes += notes.length;
    totals.skipped += notes.length - pending.length;

    let sChunks = 0;
    let sChars = 0;
    let sNotes = 0;
    let sErr = 0;

    await mapWithConcurrency(pending, concurrency, async (n) => {
      const chunks = chunkNote(n.content);
      if (!chunks.length) return;
      const texts = chunks.map((c) => embedTextForChunk(n.title, c));
      const chars = texts.reduce((a, t) => a + t.length, 0);
      sChunks += chunks.length;
      sChars += chars;
      if (dry) return;
      try {
        const vecs = await embedTexts(texts);
        const records: ChunkRecord[] = chunks.map((c, i) => ({
          section: c.section,
          pos: c.pos,
          content: c.content,
          embedding: vecs[i] ?? null,
        }));
        const rec: IndexRecord = {
          path: n.path,
          id: n.note_id ?? undefined,
          title: n.title,
          type: n.type,
          visibility: n.visibility,
          tags: n.tags ?? [],
          links: [],
          created: n.created ?? undefined,
          updated: n.updated ?? undefined,
          excerpt: undefined,
          content: n.content,
        };
        await idx.upsertChunks(spaceId, rec, records);
        sNotes += 1;
      } catch (err) {
        sErr += 1;
        console.error(`  [${spaceId}] ${n.path} FAILED: ${(err as Error).message}`);
      }
    });

    totals.chunks += sChunks;
    totals.chars += sChars;
    totals.embeddedNotes += sNotes;
    totals.errors += sErr;
    if (pending.length) {
      console.log(
        `  ${spaceId}: notes=${notes.length} pending=${pending.length} embedded=${sNotes} chunks=${sChunks} errors=${sErr}`,
      );
    }
  }

  const estTokens = Math.round(totals.chars / 4);
  const estCost = (estTokens / 1_000_000) * USD_PER_MTOK;
  console.log(
    `\nDone. spaces=${spaceIds.length} notes=${totals.notes} skipped=${totals.skipped} ` +
      `embeddedNotes=${totals.embeddedNotes} chunks=${totals.chunks} errors=${totals.errors}`,
  );
  console.log(
    `Embedding volume: ~${estTokens.toLocaleString()} tokens ≈ $${estCost.toFixed(4)} ` +
      `(text-embedding-3-small @ $${USD_PER_MTOK}/1M)${dry ? "  [DRY RUN — nothing written]" : ""}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("backfill-embeddings failed:", e);
    process.exit(1);
  });
