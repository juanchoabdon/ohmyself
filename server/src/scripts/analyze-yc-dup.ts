import "../env.js";
import * as Y from "yjs";
import { applyUpdate } from "yjs";
import { buildCore, allowedVisibilities } from "../core/index.js";
import { loadCollabState } from "../collab/state-store.js";
import { yDocToMarkdown, collabFieldName } from "../collab/schema.js";

function countXmlNodes(ydoc: Y.Doc): number {
  const frag = ydoc.getXmlFragment(collabFieldName());
  let n = 0;
  const walk = (el: Y.XmlElement | Y.XmlFragment | Y.XmlText) => {
    if (el instanceof Y.XmlText) return;
    n++;
    for (let i = 0; i < el.length; i++) {
      const child = el.get(i);
      if (child) walk(child as Y.XmlElement | Y.XmlFragment | Y.XmlText);
    }
  };
  walk(frag);
  return n;
}

function sliceAt(label: string, body: string, at: number) {
  console.log(`\n--- ${label} @${at} ---`);
  console.log(body.slice(at, at + 200));
}

const spaceId = "1315727f-5d16-47e1-8c14-93080dd6882e";
const path = "strategy/yc-fall-2026-application.md";

function analyze(label: string, body: string) {
  const b = body.replace(/\s+$/, "");
  const probe = b.slice(0, 120);
  const seams: number[] = [];
  let at = b.indexOf(probe, 1);
  while (at !== -1) {
    seams.push(at);
    at = b.indexOf(probe, at + 1);
  }
  console.log(`\n=== ${label} len=${b.length} seams=${seams.length} ===`);
  console.log("seam positions:", seams.slice(0, 10));

  for (const n of [2, 3, 4, 5]) {
    const size = Math.floor(b.length / n);
    const parts = Array.from({ length: n }, (_, i) =>
      b.slice(i * size, i === n - 1 ? b.length : (i + 1) * size).trim(),
    );
    const allEq = parts.every((p) => p === parts[0]);
    console.log(`split/${n}: lens=[${parts.map((p) => p.length).join(",")}] allEqual=${allEq}`);
    if (!allEq && parts[0] && parts[1]) {
      for (let i = 0; i < Math.min(parts[0].length, parts[1].length); i++) {
        if (parts[0][i] !== parts[1][i]) {
          console.log(`  first diff/${n} at ${i}:`, JSON.stringify(parts[0].slice(Math.max(0, i - 30), i + 50)));
          console.log(`  vs:`, JSON.stringify(parts[1].slice(Math.max(0, i - 30), i + 50)));
          break;
        }
      }
    }
  }

  if (seams.length >= 1) {
    const chunk0 = b.slice(0, seams[0]!).trim();
    const chunk1 = b.slice(seams[0]!, seams[1] ?? b.length).trim();
    console.log(`seam-chunk0=${chunk0.length} chunk1=${chunk1.length} equal=${chunk0 === chunk1}`);
  }

  const markers = [
    "# YC Fall 2026",
    "## Purpose",
    "## Operational issue",
    "## Application answers",
    "## Founder video",
    "## Company",
  ];
  for (const m of markers) {
    let c = 0;
    let i = 0;
    while ((i = b.indexOf(m, i)) !== -1) {
      c++;
      i += m.length;
    }
    console.log(`${m}: ${c}x`);
  }
  const heads = [...b.matchAll(/^## .+$/gm)].map((m) => m[0]);
  const freq = new Map<string, number>();
  for (const h of heads) freq.set(h, (freq.get(h) ?? 0) + 1);
  const dupes = [...freq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  console.log("dup h2:", dupes.slice(0, 12));

  // Find repeated 80-char windows (skip title).
  const sample = b.slice(200, 400);
  let rep = 0;
  let pos = 0;
  while ((pos = b.indexOf(sample, pos + 1)) !== -1) rep++;
  console.log("repeat window count:", rep, "sample:", JSON.stringify(sample.slice(0, 60)));

  // Try detect stacked near-copies: same opening paragraph repeated.
  const opener = b.split("\n\n")[0] ?? "";
  let openerCount = 0;
  pos = 0;
  while ((pos = b.indexOf(opener, pos)) !== -1) {
    openerCount++;
    pos += opener.length;
  }
  console.log("opener count:", openerCount, "opener len:", opener.length);
}

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const note = await brain.readNote(spaceId, path, allowed);
  analyze("vault", note.body);
  sliceAt("vault", note.body, 0);
  sliceAt("vault", note.body, 5660);
  sliceAt("vault", note.body, 11320);

  const stored = await loadCollabState(spaceId, path);
  if (stored) {
    const ydoc = new Y.Doc();
    applyUpdate(ydoc, stored);
    const ymd = yDocToMarkdown(ydoc);
    analyze("collab", ymd);
    console.log("xml nodes:", countXmlNodes(ydoc));
    sliceAt("collab-md", ymd, 0);
    sliceAt("collab-md", ymd, 5720);
  }

  // Clean reference: hydrate fresh from vault round-trip once.
  const { roundTripMarkdown } = await import("../collab/schema.js");
  const once = roundTripMarkdown(note.body);
  console.log("\nvault round-trip len:", once.length, "vault len:", note.body.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
