/** Inspect the bonds capital-position note size (collab doubling suspect). */
import "../env.js";
import { buildCore, allowedVisibilities } from "../core/index.js";

const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";
const PATH = "finance/2026-07-capital-position.md";

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const note = await brain.readNote(BONDS, PATH, allowed);
  if (!note) {
    console.log("note not found");
    return;
  }
  const body = note.body ?? "";
  console.log("body chars:", body.length);
  const lines = body.split("\n");
  console.log("lines:", lines.length);
  // Detect doubling: compare first half vs second half.
  const half = Math.floor(body.length / 2);
  const a = body.slice(0, half);
  const b = body.slice(half, half * 2);
  console.log("first half === second half:", a === b);
  // Look for repeated heading blocks.
  const headings = lines.filter((l) => l.startsWith("#"));
  const counts = new Map<string, number>();
  for (const h of headings) counts.set(h, (counts.get(h) ?? 0) + 1);
  const dupes = [...counts.entries()].filter(([, n]) => n > 1);
  console.log("duplicated headings:", dupes.length);
  for (const [h, n] of dupes.slice(0, 10)) console.log(`  x${n}  ${h.slice(0, 80)}`);
  console.log("\nfirst 300 chars:\n", body.slice(0, 300));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
