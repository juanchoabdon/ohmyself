import "../env.js";
import { buildCore, allowedVisibilities } from "../core/index.js";
import { dedupeExactDoubleBody } from "../core/dedupeBody.js";

const TARGETS = [
  "meetings/2026-07-15-product-specs-sharks.md",
  "meetings/2026-07-15-exco-q3-26-day-1-2026-07-14-08-55-cst.md",
  "meetings/2026-07-15-demo-ai-assistant.md",
  "meetings/2026-07-14-exco-q3-26-day-1.md",
];

async function main(): Promise<void> {
  const userId = process.env.OHMYSELF_USER_ID ?? "50e99419-6adb-45bf-9e49-9235c990444e";
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");

  for (const path of TARGETS) {
    const note = await brain.readNote(userId, path, allowed);
    const { body, deduped } = dedupeExactDoubleBody(note.body);
    if (!deduped) {
      console.log("skip (no dup)", path);
      continue;
    }
    await brain.updateNote(userId, path, { body }, allowed);
    console.log("fixed", path, `${note.body.length} -> ${body.length}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
