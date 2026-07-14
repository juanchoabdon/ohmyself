/**
 * One-off recovery: write recovered bodies (from agent transcripts) back into
 * bonds notes whose body was wiped by the collab autosave bug. Preserves the
 * note's current frontmatter; only the body changes.
 *
 * Usage: tsx src/scripts/restore-from-files.ts [--apply]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import "../env.js";
import { buildCore } from "../core/index.js";
import { parseNote, serializeNote, todayISO } from "../core/frontmatter.js";

const SPACE = "1315727f-5d16-47e1-8c14-93080dd6882e"; // bonds
const DIR = "/tmp/recovered-bodies";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const core = buildCore();
  const files = await fs.readdir(DIR);

  for (const file of files) {
    const notePath = file.replace(/__/g, "/");
    const body = await fs.readFile(path.join(DIR, file), "utf8");
    const raw = await core.vault.read(SPACE, notePath);
    if (raw == null) {
      console.log(`✗ ${notePath} — not in vault, skipping`);
      continue;
    }
    const { meta, body: current } = parseNote(raw, notePath);
    if (current.trim()) {
      console.log(`• ${notePath} — already has body (${current.trim().length} chars), skipping`);
      continue;
    }
    console.log(`${apply ? "→" : "•"} ${notePath} — restoring ${body.trim().length} chars`);
    if (apply) {
      await core.brain.updateNote(
        SPACE,
        notePath,
        { body },
        ["public", "private", "secret"],
        { author: "agent:cursor", summary: "restore body wiped by collab bug (from transcripts)" },
      );
      console.log("  ✓ restored");
    }
  }
  console.log(`\nDone (${apply ? "APPLY" : "dry run"}).`);
}

main().catch((err) => {
  console.error("restore failed:", err);
  process.exit(1);
});
