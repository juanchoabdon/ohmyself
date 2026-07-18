import "../env.js";
import { allowedVisibilities, parseNote } from "../core/index.js";
import { SupabaseVersionStore } from "../core/versions/supabase.js";

const spaceId = "1315727f-5d16-47e1-8c14-93080dd6882e";
const path = "strategy/yc-fall-2026-application.md";

async function main(): Promise<void> {
  const allowed = allowedVisibilities("secret");
  const versions = new SupabaseVersionStore();

  // Peak human version (before my repair) = 14115 @ 22914.
  const peak = parseNote((await versions.readAtVersion(spaceId, path, "14115", allowed))!, path).body;
  const clean = parseNote((await versions.readAtVersion(spaceId, path, "20313", allowed))!, path).body;

  console.log("peak len", peak.length, "clean len", clean.length);

  // Unique H2 sections in each.
  const h2 = (b: string) => [...b.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const peakH2 = h2(peak);
  const cleanH2 = h2(clean);
  console.log("\npeak H2 sections (", peakH2.length, "):");
  peakH2.forEach((h, i) => console.log(`  ${i}: ${h}`));
  console.log("\nclean H2 sections (", cleanH2.length, "):");
  cleanH2.forEach((h, i) => console.log(`  ${i}: ${h}`));

  // Content in peak NOT in clean (the stripped suffix).
  const suffix = peak.slice(clean.length);
  console.log("\n=== stripped suffix (", suffix.length, "chars) ===");
  console.log(suffix.slice(0, 4000));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
