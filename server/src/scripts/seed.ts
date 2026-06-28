import "../env.js";
import { buildCore } from "../core/index.js";
import { seedTemplateBrain } from "../templates.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const userId = argFor("--user") ?? process.env.OHMYSELF_USER_ID;
  if (!userId) {
    console.error("Usage: pnpm seed --user <userId>   (or set OHMYSELF_USER_ID)");
    process.exit(1);
  }
  const core = buildCore();
  console.log(`Seeding template brain into user ${userId} (backend: ${core.backend})...`);
  const imported = await seedTemplateBrain(core.brain, userId, { fromDisk: true });
  for (const rel of imported) console.log(`  ✓ ${rel}`);
  console.log(`Done — ${imported.length} notes.`);
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
