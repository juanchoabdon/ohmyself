import "../env.js";
import { buildCore, allowedVisibilities } from "../core/index.js";

const spaceId = "1315727f-5d16-47e1-8c14-93080dd6882e";
const paths = [
  "strategy/yc-fall-2026-application.md",
  "strategy/company-plan-2026-2027.md",
  "strategy/founder-x-profiles.md",
  "product/history/product-evolution.md",
  "company/brand/domain-strategy.md",
  "people/danna-valentina-cardozo.md",
  "people/daniel-murte.md",
  "notes/plan-maestro-salida-de-rappi-build-in-public-y-launch-de-bonds-jul-2026-mar-2027.md",
  "company/history/globa-flimp-papercheck.md",
  "company/legal/entity-strategy.md",
];

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  for (const p of paths) {
    const note = await brain.readNote(spaceId, p, allowed).catch(() => null);
    console.log(p, "->", note ? `${note.body.length} chars` : "MISSING");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
