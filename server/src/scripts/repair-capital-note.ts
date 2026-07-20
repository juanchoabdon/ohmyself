/** One-off: rebuild finance/2026-07-capital-position.md from its first copy
 *  (collab doubling stacked ~256 near-identical copies) and clear collab state. */
import "../env.js";
import { buildCore, allowedVisibilities } from "../core/index.js";
import { serviceClient } from "../core/supabase.js";

const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";
const PATH = "finance/2026-07-capital-position.md";
const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const note = await brain.readNote(BONDS, PATH, allowed);
  const body = note.body ?? "";
  console.log("current chars:", body.length);

  // The note starts with a blockquote disclaimer; each stacked copy repeats the
  // "## Reported position" heading. Cut at the second occurrence of the first
  // heading that appears, keeping everything before it (= first full copy).
  const lines = body.split("\n");
  const headingIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("## Reported position")) headingIdx.push(i);
  }
  console.log("copies detected:", headingIdx.length);
  if (headingIdx.length < 2) {
    console.log("nothing to repair");
    return;
  }

  // First copy spans from 0 until the line where the SECOND copy begins. The
  // second copy may start with the disclaimer or the H1 a few lines above its
  // "## Reported position" — walk back to include those in the cut point.
  let cut = headingIdx[1]!;
  for (let i = cut - 1; i >= 0 && i > cut - 6; i--) {
    const l = lines[i]!.trim();
    if (l.startsWith("# ") || l.startsWith("> Confidential") || l === "") cut = i;
    else break;
  }
  const first = lines.slice(0, cut).join("\n").replace(/\s+$/, "") + "\n";
  console.log("repaired chars:", first.length);
  console.log("--- head ---\n" + first.slice(0, 200));
  console.log("--- tail ---\n" + first.slice(-300));

  if (dryRun) return;

  await brain.updateNote(BONDS, PATH, { body: first }, allowed, {
    author: "ohmyself",
    summary: "repair collab-duplicated body (256 stacked copies -> 1)",
  });
  const { error } = await serviceClient()
    .from("collab_docs")
    .delete()
    .eq("space_id", BONDS)
    .eq("path", PATH);
  if (error) console.log("collab_docs delete warning:", error.message);
  console.log("repaired + collab state cleared");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
