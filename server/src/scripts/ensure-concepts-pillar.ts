/**
 * Ensure every self space has the Concept taxonomy + concepts/_index.md, then
 * profile all concept pages (infer "Qué es" summaries from accrued facts).
 *
 *   tsx src/scripts/ensure-concepts-pillar.ts              # all self spaces
 *   tsx src/scripts/ensure-concepts-pillar.ts --user <id>  # one space
 *   tsx src/scripts/ensure-concepts-pillar.ts --profile-only  # skip pillar setup
 */
import "../env.js";
import {
  allowedVisibilities,
  buildCore,
  ensureConceptPillar,
  getUserConfig,
  listSelfSpaceIds,
  profileStaleConcepts,
} from "../core/index.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const only = argFor("--user");
  const profileOnly = hasFlag("--profile-only");
  const force = !hasFlag("--stale");
  const minFacts = Number(argFor("--min") ?? "2") || 2;
  const limit = Number(argFor("--limit") ?? "5000") || 5000;
  const concurrency = Number(argFor("--conc") ?? "4") || 4;

  const spaceIds = await listSelfSpaceIds(only);
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");

  console.log(`Concepts pillar — spaces=${spaceIds.length} profileOnly=${profileOnly} force=${force}`);

  let configsPatched = 0;
  let indexesCreated = 0;
  const totals = { profiled: 0, skipped: 0, errors: 0, scanned: 0 };

  for (const spaceId of spaceIds) {
    try {
      if (!profileOnly) {
        const r = await ensureConceptPillar(brain, spaceId, allowed);
        if (r.configPatched) configsPatched++;
        if (r.indexCreated) indexesCreated++;
      }

      const config = await getUserConfig(spaceId);
      const c = await profileStaleConcepts(brain, spaceId, config, allowed, {
        minFacts,
        force,
        limit,
        concurrency,
      });
      totals.scanned += c.scanned;
      totals.profiled += c.profiled;
      totals.skipped += c.skipped;
      totals.errors += c.errors;
      if (c.scanned || !profileOnly) {
        console.log(
          `  ${spaceId} concepts: scanned=${c.scanned} profiled=${c.profiled} skipped=${c.skipped} errors=${c.errors}`,
        );
      }
    } catch (err) {
      console.error(`  ${spaceId} FAILED:`, (err as Error).message);
    }
  }

  console.log(
    `\nDone. configsPatched=${configsPatched} indexesCreated=${indexesCreated} profiled=${totals.profiled} skipped=${totals.skipped} errors=${totals.errors} (scanned ${totals.scanned} concept pages)`,
  );
}

main().catch((e) => {
  console.error("ensure-concepts-pillar failed:", e);
  process.exit(1);
});
