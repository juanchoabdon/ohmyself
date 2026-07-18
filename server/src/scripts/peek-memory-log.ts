import "../env.js";
import { buildCore } from "../core/index.js";

const spaceId = process.argv[2] ?? "50e99419-6adb-45bf-9e49-9235c990444e";
const tail = Number(process.argv[3] ?? "80");

async function main(): Promise<void> {
  const { brain } = buildCore();
  const note = await brain.readNote(spaceId, "memory/log.md", ["public", "private", "secret"]);
  console.log(note.body.split("\n").slice(-tail).join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
