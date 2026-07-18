/**
 * Audit: find ANY note whose body shrank sharply in a write after the bad
 * heuristic deployed (covers "live edit" collab stores, not just repair
 * summaries). Compares each version since cutoff with the previous version.
 */
import "../env.js";
import { parseNote } from "../core/index.js";
import { serviceClient } from "../core/supabase.js";

const CUTOFF = "2026-07-16T03:40:00Z";

interface VersionRow {
  id: number;
  space_id: string;
  path: string;
  author: string;
  summary: string | null;
  raw: string | null;
  created_at: string;
}

async function main(): Promise<void> {
  const { data, error } = await serviceClient()
    .from("note_versions")
    .select("id, space_id, path, author, summary, raw, created_at")
    .gte("created_at", CUTOFF)
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as VersionRow[];
  console.log(`versions since cutoff: ${rows.length}`);

  for (const v of rows) {
    if (!v.raw) continue;
    const { data: prevData } = await serviceClient()
      .from("note_versions")
      .select("id, raw")
      .eq("space_id", v.space_id)
      .eq("path", v.path)
      .lt("id", v.id)
      .not("raw", "is", null)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prev = prevData as { id: number; raw: string } | null;
    if (!prev?.raw) continue;
    const curLen = parseNote(v.raw, v.path).body.length;
    const prevLen = parseNote(prev.raw, v.path).body.length;
    // Flag shrinks > 40% and > 300 chars (title-H1 strips are tiny).
    if (prevLen - curLen > 300 && curLen < prevLen * 0.6) {
      console.log(
        `SHRANK v${v.id} ${v.space_id.slice(0, 8)}:${v.path} ${prevLen} -> ${curLen} [${v.summary}] @ ${v.created_at}`,
      );
    }
  }
  console.log("audit done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
