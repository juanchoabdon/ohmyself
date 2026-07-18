import "../env.js";
import { allowedVisibilities, parseNote } from "../core/index.js";
import { SupabaseVersionStore } from "../core/versions/supabase.js";

const spaceId = "1315727f-5d16-47e1-8c14-93080dd6882e";
const path = "strategy/yc-fall-2026-application.md";

async function main(): Promise<void> {
  const allowed = allowedVisibilities("secret");
  const versions = new SupabaseVersionStore();
  const rawClean = await versions.readAtVersion(spaceId, path, "20313", allowed);
  const rawNow = await versions.readAtVersion(spaceId, path, "20372", allowed);
  const clean = parseNote(rawClean!, path).body;
  const now = parseNote(rawNow!, path).body;
  console.log("clean len", clean.length, "now len", now.length);
  console.log("now starts with clean?", now.startsWith(clean.slice(0, 200)));
  console.log("clean at 0 in now at", now.indexOf(clean.slice(100, 200)));
  // find second occurrence of Purpose section
  const needle = "## Purpose";
  let pos = 0;
  let c = 0;
  while ((pos = now.indexOf(needle, pos)) !== -1) {
    console.log("Purpose at", pos);
    c++;
    pos += needle.length;
  }
  console.log("Purpose count in now", c);
  console.log("clean contained in now?", now.includes(clean.trim()));
  console.log("suffix len", now.length - clean.length);
  console.log("suffix start:", JSON.stringify(now.slice(clean.length, clean.length + 120)));
  console.log("suffix2 start @5726:", JSON.stringify(now.slice(5726, 5726 + 120)));
  // count a mid-doc phrase
  const phrase = "10M+ MAU";
  let pc = 0;
  let p = 0;
  while ((p = now.indexOf(phrase, p)) !== -1) {
    pc++;
    p += phrase.length;
  }
  const op = "## Operational issue";
  let oc = 0;
  let o = 0;
  while ((o = now.indexOf(op, o)) !== -1) {
    console.log("Operational issue at", o);
    oc++;
    o += op.length;
  }
  console.log("Operational issue count", oc, "in clean", clean.split(op).length - 1);
  console.log("clean tail:", JSON.stringify(clean.slice(-200)));
  console.log("clean has Operational?", clean.includes("Operational"));
}

main();
