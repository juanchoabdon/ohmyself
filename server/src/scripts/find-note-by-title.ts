import "../env.js";
import { buildCore } from "../core/index.js";

const spaceId = process.argv[2] ?? "50e99419-6adb-45bf-9e49-9235c990444e";
const term = (process.argv[3] ?? "training").toLowerCase();

async function main(): Promise<void> {
  const { brain } = buildCore();
  const notes = await brain.listNotes(spaceId, {
    allowed: ["public", "private", "secret"],
    limit: 10000,
  });
  const hits = notes.filter(
    (n) =>
      String(n.title ?? "").toLowerCase().includes(term) ||
      String(n.path ?? "").toLowerCase().includes(term),
  );
  console.log(`${hits.length} match(es) for "${term}":`);
  for (const n of hits) console.log(" -", n.path, "|", n.title);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
