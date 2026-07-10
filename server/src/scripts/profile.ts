import "../env.js";
import { allowedVisibilities, buildCore, getUserConfig, profilePerson, profileStalePeople } from "../core/index.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/**
 * Generate/refresh synthesized "Read" profiles on person pages.
 *
 *   tsx src/scripts/profile.ts --user <id> --person <slug>       # one person
 *   tsx src/scripts/profile.ts --user <id> --all [--min 3] [--limit 200] [--force] [--conc 4]
 */
async function main(): Promise<void> {
  const userId = argFor("--user") ?? process.env.OHMYSELF_USER_ID;
  if (!userId) {
    console.error("Usage: tsx src/scripts/profile.ts --user <id> (--person <slug> | --all)");
    process.exit(1);
  }
  const { brain } = buildCore();
  const config = await getUserConfig(userId);
  const allowed = allowedVisibilities("secret");
  const minFacts = Number(argFor("--min") ?? "3");
  const force = hasFlag("--force");

  const person = argFor("--person");
  if (person) {
    const r = await profilePerson(brain, userId, config, allowed, person, { minFacts, force });
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const limit = Number(argFor("--limit") ?? "500");
  const concurrency = Number(argFor("--conc") ?? "4");
  console.log(`Profiling stale people (min=${minFacts}, limit=${limit}, conc=${concurrency}, force=${force})…`);
  const r = await profileStalePeople(brain, userId, config, allowed, { minFacts, force, limit, concurrency });
  console.log(`scanned=${r.scanned} profiled=${r.profiled} skipped=${r.skipped} errors=${r.errors}`);
  for (const p of r.people) console.log(`  ✓ ${p.path} (${p.facts} facts)`);
}

main().catch((e) => {
  console.error("profile failed:", e);
  process.exit(1);
});
