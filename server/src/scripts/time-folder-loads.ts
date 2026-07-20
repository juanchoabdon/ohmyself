/** Time sidebar folder queries against Supabase (diagnose slow expand). */
import "../env.js";
import { buildCore, allowedVisibilities } from "../core/index.js";

const { brain } = buildCore();
const allowed = allowedVisibilities("secret");
const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";
const SELF = "50e99419-6adb-45bf-9e49-9235c990444e";

async function timeIt(label: string, space: string, prefix: string): Promise<void> {
  const t0 = Date.now();
  try {
    const notes = await brain.listNotes(space, { prefix, allowed, limit: 5000 });
    console.log(label.padEnd(20), String(notes.length).padStart(4), "notes in", Date.now() - t0, "ms");
  } catch (e) {
    console.log(label.padEnd(20), "ERROR after", Date.now() - t0, "ms:", (e as Error).message.slice(0, 200));
  }
}

async function main(): Promise<void> {
  await timeIt("bonds people/", BONDS, "people/");
  await timeIt("bonds strategy/", BONDS, "strategy/");
  await timeIt("bonds engineering/", BONDS, "engineering/");
  await timeIt("self people/", SELF, "people/");
  await timeIt("self meetings/", SELF, "meetings/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
