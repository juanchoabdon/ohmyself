/**
 * Collab reliability invariants — run after ANY change to collab/, dedupeBody
 * or titleBody. Exercises the exact failure modes we've been bitten by:
 *   1. markdown ⇄ Y doc round-trip stability
 *   2. state persistence across "restarts" (encode/apply)
 *   3. re-hydration idempotency (no duplication on repeated hydrate)
 *   4. THE KILLER: merging two independent Yjs lineages duplicates content —
 *      verify it happens AND that dedupeRepeatedBody detects/repairs it
 *   5. shared-lineage merge is safe (normal collab)
 *   6. dedupe NEVER touches legitimate bodies (regression for the
 *      dedupeStackedSuffix disaster: short first section + long rest)
 *   7. stripRedundantTitleH1 only strips an exact-match leading H1
 *
 * Usage: npx tsx src/scripts/test-collab-invariants.ts
 * Exit 0 = all pass.
 */
import * as Y from "yjs";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import { applyMarkdownToYDoc } from "../collab/hydrate.js";
import { collabFieldName, roundTripMarkdown, yDocToMarkdown } from "../collab/schema.js";
import { dedupeRepeatedBody, repairCollabBody } from "../core/dedupeBody.js";
import { stripRedundantTitleH1 } from "../core/titleBody.js";

let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const SAMPLE = `## Purpose

Canonical working note for something important. It has **bold**, _italics_ and a [link](https://example.com).

## Current status — as of 2026-07-15

- First bullet with detail.
- Second bullet.
- Third bullet with \`code\`.

## Long section

${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(30)}

### Sub

> A quote block
> with two lines.

## Decisions

1. Numbered one.
2. Numbered two.
`;

function docFromMarkdown(md: string): Y.Doc {
  const doc = new Y.Doc();
  applyMarkdownToYDoc(doc, md);
  return doc;
}

// ── 1. Round-trip stability ──────────────────────────────────────────────────
{
  const once = yDocToMarkdown(docFromMarkdown(SAMPLE));
  const twice = yDocToMarkdown(docFromMarkdown(once));
  check("round-trip stable after first normalization", once.trim() === twice.trim());
  check(
    "round-trip matches roundTripMarkdown()",
    once.trim() === roundTripMarkdown(SAMPLE).trim(),
  );
}

// ── 2. Restart persistence (encode → new doc → apply) ───────────────────────
{
  const a = docFromMarkdown(SAMPLE);
  const b = new Y.Doc();
  applyUpdate(b, encodeStateAsUpdate(a));
  check("state survives encode/apply (restart)", yDocToMarkdown(a) === yDocToMarkdown(b));
}

// ── 3. Re-hydration idempotency ──────────────────────────────────────────────
{
  const doc = docFromMarkdown(SAMPLE);
  const before = yDocToMarkdown(doc);
  applyMarkdownToYDoc(doc, before); // hydrate again with same content
  applyMarkdownToYDoc(doc, before);
  const after = yDocToMarkdown(doc);
  check("repeated hydration does not duplicate", before === after, `${before.length} -> ${after.length}`);
}

// ── 4. Independent-lineage merge duplicates; dedupe catches it ───────────────
{
  const a = docFromMarkdown(SAMPLE); // lineage A (e.g. fresh server hydrate)
  const b = docFromMarkdown(SAMPLE); // lineage B (e.g. stale tab from old hydrate)
  applyUpdate(a, encodeStateAsUpdate(b)); // stale client syncs into new room
  const merged = yDocToMarkdown(a);
  const clean = yDocToMarkdown(docFromMarkdown(SAMPLE));
  const duplicated = merged.length > clean.length * 1.5;
  check("independent-lineage merge DOES duplicate (expected Yjs behavior)", duplicated, `merged=${merged.length} clean=${clean.length}`);

  const { body: repaired, deduped } = dedupeRepeatedBody(merged);
  check("dedupeRepeatedBody detects the merge duplication", deduped);
  check(
    "repaired body equals clean body",
    deduped && repaired.trim() === clean.trim(),
    `repaired=${repaired.length} clean=${clean.length}`,
  );
}

// ── 5. Shared-lineage merge is safe (normal collab flow) ─────────────────────
{
  const a = docFromMarkdown(SAMPLE);
  const b = new Y.Doc();
  applyUpdate(b, encodeStateAsUpdate(a)); // same lineage
  applyMarkdownToYDoc(b, `${yDocToMarkdown(b)}\n\n## New section\n\nAdded by client B.\n`);
  applyUpdate(a, encodeStateAsUpdate(b)); // merge back
  const merged = yDocToMarkdown(a);
  check(
    "shared-lineage merge keeps edit without duplication",
    merged.includes("Added by client B") && !dedupeRepeatedBody(merged).deduped &&
      merged.split("## Purpose").length === 2,
  );
}

// ── 6. Dedupe safety on legitimate bodies (regression: stacked-suffix bug) ──
{
  const shortFirstSection = `## Purpose

Short intro.

## Extended benchmark — long content

${"Real content that must never be chopped. ".repeat(120)}

## More

${"Even more legitimate content. ".repeat(80)}
`;
  const r1 = repairCollabBody(shortFirstSection);
  check("legit body (short first section + long rest) untouched", !r1.deduped && r1.body === shortFirstSection);

  const legit = `# Note\n\n${"Content paragraph. ".repeat(50)}`;
  const r2 = repairCollabBody(legit);
  check("legit single-copy body untouched", !r2.deduped && r2.body === legit);

  const doubled = `${SAMPLE.trim()}\n\n${SAMPLE.trim()}\n`;
  const r3 = repairCollabBody(doubled);
  check("exact 2x repetition repaired", r3.deduped && r3.body.trim() === SAMPLE.trim());

  const tripled = `${SAMPLE.trim()}\n\n${SAMPLE.trim()}\n\n${SAMPLE.trim()}\n`;
  const r4 = repairCollabBody(tripled);
  check("exact 3x repetition repaired", r4.deduped && r4.body.trim() === SAMPLE.trim());

  const nearDouble = `${SAMPLE.trim()}\n\n${SAMPLE.trim()}\n\nBut with an extra trailing line.\n`;
  const r5 = repairCollabBody(nearDouble);
  check("near-duplicate with real extra content untouched", !r5.deduped);
}

// ── 7. stripRedundantTitleH1 ─────────────────────────────────────────────────
{
  const t = "My Note Title";
  check(
    "strips exact-match leading H1",
    stripRedundantTitleH1(`# My Note Title\n\n## Body\n\nText`, t) === `## Body\n\nText`,
  );
  const diff = `# Different Title\n\nText`;
  check("keeps non-matching H1", stripRedundantTitleH1(diff, t) === diff);
  const noH1 = `## Section\n\nText`;
  check("keeps body without H1", stripRedundantTitleH1(noH1, t) === noH1);
  const midH1 = `Intro paragraph.\n\n# My Note Title\n\nText`;
  check("keeps H1 that is not leading", stripRedundantTitleH1(midH1, t) === midH1);
}

console.log(failures === 0 ? "\nALL INVARIANTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
