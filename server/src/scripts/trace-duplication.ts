/** Walk a note's version history to find the write that doubled its body. */
import "../env.js";
import { allowedVisibilities } from "../core/index.js";
import { SupabaseVersionStore } from "../core/versions/supabase.js";

const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";
const PATH = process.argv[2] ?? "engineering/post-demo-cleanup.md";
const MARKER = "\n## Purpose";

function occurrences(raw: string): number {
  let count = 0;
  let i = raw.indexOf(MARKER);
  while (i >= 0) {
    count++;
    i = raw.indexOf(MARKER, i + 1);
  }
  return count;
}

async function main(): Promise<void> {
  const versions = new SupabaseVersionStore();
  const allowed = allowedVisibilities("secret");

  const entries = await versions.history(BONDS, PATH, allowed, { limit: 100 });
  console.log(`${entries.length} versions of ${PATH}\n`);

  let prev = 0;
  for (const e of [...entries].reverse()) {
    const raw = await versions.readAtVersion(BONDS, PATH, e.version, allowed).catch(() => null);
    const size = raw?.length ?? -1;
    const hits = raw ? occurrences(raw) : -1;
    const delta = prev ? size - prev : 0;
    const doubled = prev > 0 && size >= prev * 1.8;
    console.log(
      `${new Date(e.timestamp * 1000).toISOString()}  ${e.op.padEnd(7)} ` +
        `${String(size).padStart(7)} chars (${delta >= 0 ? "+" : ""}${delta})  ` +
        `"## Purpose" x${hits}${doubled ? "   <<< DOUBLED HERE" : ""}`,
    );
    console.log(`    author:  ${e.author}`);
    console.log(`    summary: ${e.summary || "-"}`);
    prev = size;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
