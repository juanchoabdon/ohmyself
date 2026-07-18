import "../env.js";
import { buildCore, allowedVisibilities } from "../core/index.js";

const spaceId = "1315727f-5d16-47e1-8c14-93080dd6882e";
const path = "strategy/yc-fall-2026-application.md";

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const hist = await brain.getNoteHistory(spaceId, path, allowed, { limit: 30 });
  for (const h of hist) {
    console.log(new Date(h.timestamp).toISOString(), h.version.slice(0, 8), h.op, h.author, h.summary);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
