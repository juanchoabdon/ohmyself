/**
 * Regression tests for the note-stacking bug (Bonds wiki, 2026-08-01).
 *
 * A room's Yjs state is a lineage of items. Seeding from markdown mints a new
 * lineage; when a client still holds the old one, Yjs merges both and the whole
 * note is stacked. These tests pin the invariant: one room, one lineage.
 */
import { applyUpdate, encodeStateAsUpdate, Doc } from "yjs";
import { hydrateYDocOnce, replaceYDocMarkdown } from "../collab/hydrate.js";
import { yDocToMarkdown } from "../collab/schema.js";

const BODY_A = [
  "## Purpose",
  "",
  "Plan to remove the throwaway code the demo left behind.",
  "",
  "## Why now",
  "",
  "Two new developers are about to read this codebase.",
].join("\n");

const BODY_B = [
  BODY_A,
  "",
  "## Decision — the tracker POC is dead",
  "",
  "Artifacts are the canonical shared living-object surface.",
].join("\n");

let failures = 0;

function count(text: string, needle: string): number {
  let n = 0;
  let i = text.indexOf(needle);
  while (i >= 0) {
    n++;
    i = text.indexOf(needle, i + 1);
  }
  return n;
}

function check(label: string, doc: Doc, expected: string): void {
  const md = yDocToMarkdown(doc).trim();
  const copies = count(md, "## Purpose");
  const ok = md === expected.trim();
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}\n` +
      `      ${md.length} chars (expected ${expected.trim().length}), "## Purpose" x${copies}`,
  );
  if (!ok && copies > 1) console.log(`      -> the note was STACKED ${copies} times`);
}

/** A browser that synced a room, then reconnects and pushes its state back. */
function client(from: Doc): Doc {
  const c = new Doc();
  applyUpdate(c, encodeStateAsUpdate(from));
  return c;
}

function main(): void {
  // 1. Seeding is once-only, even if hydration runs repeatedly.
  const once = new Doc();
  console.log(`seeded first time: ${hydrateYDocOnce(once, BODY_A)}`);
  console.log(`seeded second time: ${hydrateYDocOnce(once, BODY_A)} (must be false)`);
  if (hydrateYDocOnce(once, BODY_B)) failures++;
  check("repeated hydration keeps one copy", once, BODY_A);

  // 2. The bug as it happened: server drops the lineage and re-seeds from the
  //    vault while a client still holds the previous lineage.
  const server = new Doc();
  hydrateYDocOnce(server, BODY_A);
  const tab = client(server);

  const reseeded = new Doc(); // fresh lineage, as delete-state + hydrate produced
  hydrateYDocOnce(reseeded, BODY_B);
  applyUpdate(reseeded, encodeStateAsUpdate(tab)); // stale tab reconnects
  const stackedMd = yDocToMarkdown(reseeded).trim();
  const stacked = count(stackedMd, "## Purpose") > 1;
  console.log(
    `${stacked ? "PASS" : "FAIL"}  re-seeding a new lineage still stacks (this is why we stopped doing it)\n` +
      `      "## Purpose" x${count(stackedMd, "## Purpose")}`,
  );
  if (!stacked) failures++;

  // 3. The fix: keep the lineage, converge it to the vault with a diff. A stale
  //    client reconnecting into it merges cleanly, because it is the same lineage.
  const kept = new Doc();
  hydrateYDocOnce(kept, BODY_A);
  const staleTab = client(kept);
  replaceYDocMarkdown(kept, BODY_B); // reconcile toward the vault
  applyUpdate(kept, encodeStateAsUpdate(staleTab)); // stale tab reconnects
  check("restored lineage + diff survives a stale client", kept, BODY_B);

  // 4. Reconciling twice is a no-op.
  replaceYDocMarkdown(kept, BODY_B);
  check("reconcile is idempotent", kept, BODY_B);

  console.log(`\n${failures === 0 ? "all invariants hold" : `${failures} FAILURES`}`);
  if (failures) process.exit(1);
}

main();
