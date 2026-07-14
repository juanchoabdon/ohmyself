/**
 * One-off recovery: restore note bodies wiped by the collab autosave bug
 * (Yjs sync emptied the editor → autosave persisted empty bodies).
 *
 * Dry run:  pnpm tsx src/scripts/restore-wiped-bodies.ts --space <slug-or-id>
 * Apply:    pnpm tsx src/scripts/restore-wiped-bodies.ts --space <slug-or-id> --apply
 */
import "../env.js";
import { buildCore } from "../core/index.js";
import { parseNote } from "../core/frontmatter.js";
import { serviceClient } from "../core/supabase.js";

const ALLOWED = ["public", "private", "secret"] as const;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function resolveSpaceId(slugOrId: string): Promise<string> {
  const sb = serviceClient();
  const { data } = await sb.from("spaces").select("id, slug").ilike("slug", slugOrId).maybeSingle();
  if (data?.id) return data.id as string;
  return slugOrId; // assume it's already an id
}

async function main(): Promise<void> {
  const spaceArg = arg("--space");
  if (!spaceArg) {
    console.error("Usage: tsx restore-wiped-bodies.ts --space <slug-or-id> [--apply]");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const core = buildCore();
  const spaceId = await resolveSpaceId(spaceArg);
  console.log(`Space: ${spaceArg} → ${spaceId}  (${apply ? "APPLY" : "dry run"})\n`);

  const sb = serviceClient();
  const paths = await core.vault.listPaths(spaceId);
  let wiped = 0;
  let restored = 0;

  for (const path of paths) {
    const raw = await core.vault.read(spaceId, path);
    if (raw == null) continue;
    const { body } = parseNote(raw, path);
    if (body.trim()) continue;
    wiped++;

    // Latest version whose raw parses to a non-empty body.
    const { data: rows } = await sb
      .from("note_versions")
      .select("id, raw, author, op, created_at")
      .eq("space_id", spaceId)
      .eq("path", path)
      .order("id", { ascending: false })
      .limit(50);

    const candidate = (rows ?? []).find((r) => {
      if (!r.raw) return false;
      try {
        return parseNote(r.raw as string, path).body.trim().length > 0;
      } catch {
        return false;
      }
    });

    if (!candidate) {
      console.log(`✗ ${path} — empty body, NO version with content found`);
      continue;
    }

    const goodBody = parseNote(candidate.raw as string, path).body;
    console.log(
      `${apply ? "→" : "•"} ${path} — empty; best version #${candidate.id} ` +
        `(${candidate.op} by ${candidate.author} @ ${candidate.created_at}, body ${goodBody.trim().length} chars)`,
    );

    if (apply) {
      await core.brain.restoreVersion(spaceId, path, String(candidate.id), [...ALLOWED], {
        author: "agent:cursor",
        summary: "restore body wiped by collab bug",
      });
      restored++;
      console.log(`  ✓ restored`);
    }
  }

  console.log(`\nDone. ${wiped} notes with empty body${apply ? `, ${restored} restored` : ""}.`);
}

main().catch((err) => {
  console.error("restore failed:", err);
  process.exit(1);
});
