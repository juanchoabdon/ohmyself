/** Dump the Bonds taxonomy + the four misfiled project notes, to plan a rehome. */
import "../env.js";
import { allowedVisibilities, buildCore, getSpaceConfig } from "../core/index.js";

const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";
const PATHS = [
  "projects/bonds-phase-0-plan-delta-v2-superseded/_index.md",
  "projects/bonds-wiki-agent-readiness-golden-path-spec-update/_index.md",
  "projects/doctrina-de-producto/_index.md",
  "projects/estrategia-de-lanzamiento-de-bonds/_index.md",
];

async function main(): Promise<void> {
  const { brain, vault } = buildCore();
  const cfg = await getSpaceConfig(BONDS);
  console.log("=== bonds noteTypes ===");
  console.log(JSON.stringify(cfg.noteTypes, null, 2));

  const paths = await vault.listPaths(BONDS);
  const folders = new Map<string, number>();
  for (const p of paths) {
    const top = p.split("/")[0]!;
    folders.set(top, (folders.get(top) ?? 0) + 1);
  }
  console.log("\n=== actual folders ===");
  for (const [f, n] of [...folders].sort((a, b) => b[1] - a[1])) console.log(`  ${f}: ${n}`);

  for (const p of PATHS) {
    const n = await brain.readNote(BONDS, p, allowedVisibilities("secret")).catch(() => null);
    console.log(`\n=== ${p}`);
    if (!n) {
      console.log("  (missing)");
      continue;
    }
    console.log(`  title: ${n.meta.title}`);
    console.log(`  type: ${n.meta.type} | tags: ${(n.meta.tags ?? []).join(", ")}`);
    console.log(`  links: ${(n.meta.links ?? []).join(", ") || "-"}`);
    console.log(`  updated: ${n.meta.updated} | chars: ${n.body.length}`);
    console.log(`  --- body head ---\n${n.body.slice(0, 600)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
