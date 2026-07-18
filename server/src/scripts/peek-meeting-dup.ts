import "../env.js";
import { buildCore, allowedVisibilities } from "../core/index.js";
import { dedupeExactDoubleBody } from "../core/dedupeBody.js";

async function main(): Promise<void> {
  const userId = process.env.OHMYSELF_USER_ID ?? "50e99419-6adb-45bf-9e49-9235c990444e";
  const dryRun = process.argv.includes("--dry-run");
  const prefix = process.argv.find((a) => a.startsWith("--prefix="))?.slice("--prefix=".length) ?? "meetings/";
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const notes = await brain.listNotes(userId, { prefix, allowed, limit: 500 });
  let fixed = 0;

  for (const n of notes) {
    const note = await brain.readNote(userId, n.path, allowed);
    const { body, deduped } = dedupeExactDoubleBody(note.body);
    if (!deduped) continue;
    console.log("DUP", n.path, `${note.body.length} -> ${body.length}`);
    if (!dryRun) {
      await brain.updateNote(userId, n.path, { body }, allowed);
    }
    fixed++;
  }

  console.log(dryRun ? `would fix ${fixed}` : `fixed ${fixed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
