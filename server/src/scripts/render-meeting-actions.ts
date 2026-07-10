/**
 * Backfill an "## Action items" section into EXISTING meeting notes, reconstructed
 * from their commitment notes (no re-distill, no cost). Dedupes EN/ES near-dupes
 * by normalized text. Skips notes that already have the section (e.g. re-ingested
 * by the new pipeline). Dry-run by default; pass --yes to write.
 */
import "../env.js";
import { allowedVisibilities, buildCore } from "../core/index.js";

const APPLY = process.argv.includes("--yes");
const userId = "50e99419-6adb-45bf-9e49-9235c990444e";

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/gi, "").replace(/\s+/g, " ").trim().slice(0, 50);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");

  const meetings = await brain.listNotes(userId, { prefix: "meetings/", allowed, limit: 5000 });
  const commitments = await brain.listNotes(userId, { types: ["commitment"], allowed, limit: 5000 });
  console.log(`meetings: ${meetings.length} · commitments: ${commitments.length}`);

  // Read commitment frontmatter to map source-meeting -> items.
  const bySource = new Map<string, { owner: string; text: string }[]>();
  await mapLimit(commitments, 40, async (c) => {
    const note = await brain.readNote(userId, c.path, allowed).catch(() => null);
    const src = note?.meta.extra?.source as string | undefined;
    if (!src) return;
    const owner = String(note!.meta.extra?.owner ?? "me");
    const text = (note!.meta.title || "").trim();
    if (!text) return;
    const arr = bySource.get(src) ?? [];
    arr.push({ owner, text });
    bySource.set(src, arr);
  });

  let touched = 0;
  for (const m of meetings) {
    const items = bySource.get(m.path);
    if (!items || !items.length) continue;
    const note = await brain.readNote(userId, m.path, allowed).catch(() => null);
    if (!note) continue;
    if (/^##\s+Action items/im.test(note.body)) continue; // already has it

    // Dedupe EN/ES near-dupes by normalized text.
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const it of items) {
      const k = normKey(it.text);
      if (seen.has(k)) continue;
      seen.add(k);
      const owner = it.owner.trim().toLowerCase() === "me" ? "Me" : it.owner.trim();
      lines.push(`- **${owner}** — ${it.text}`);
    }
    if (!lines.length) continue;
    const body = `${note.body.replace(/\s+$/, "")}\n\n## Action items\n${lines.join("\n")}\n`;
    touched++;
    if (APPLY) await brain.updateNote(userId, m.path, { body }, allowed);
  }
  console.log(`${APPLY ? "updated" : "would update"} ${touched} meeting note(s)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
