/**
 * One-off remediation: light-mode backfill marked recent meetings as "seen" in a
 * single shared ledger, so full sync ("Sync now") skips them forever and never
 * writes their meeting note. This rebuilds the ledgers:
 *   - seenFileIds  := file ids that actually have a meeting note (from source_url)
 *   - seenLightIds := everything previously seen (so light won't redo them)
 * After this, a full sync treats every doc lacking a meeting note as fresh and
 * ingests it (creating July / late-June meeting notes + commitments).
 *
 * Dry-run by default; pass --yes to write.
 */
import "../env.js";
import { serviceClient } from "../core/supabase.js";
import { allowedVisibilities, buildCore, updateConnection } from "../core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER } from "../connectors/google-auth.js";

const APPLY = process.argv.includes("--yes");

function fileIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = url.match(/(?:\/d\/|[?&]id=)([-\w]{20,})/);
  return m?.[1] ?? null;
}

async function main(): Promise<void> {
  const sb = serviceClient();
  const { data } = await sb
    .from("connections")
    .select("id,user_id,settings")
    .eq("provider", GOOGLE_DRIVE_MEETINGS_PROVIDER);
  const rows = (data ?? []) as Array<{ id: string; user_id: string; settings?: Record<string, unknown> }>;
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");

  for (const row of rows) {
    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const currentSeen = (settings.seenFileIds as string[] | undefined) ?? [];
    const currentLight = (settings.seenLightIds as string[] | undefined) ?? [];

    const metas = await brain.listNotes(row.user_id, { prefix: "meetings/", allowed, limit: 5000 });
    const backed = new Set<string>();
    let noSource = 0;
    for (const m of metas) {
      const note = await brain.readNote(row.user_id, m.path, allowed);
      const id = fileIdFromUrl(note.meta.extra?.source_url);
      if (id) backed.add(id);
      else noSource++;
    }

    const seenFileIds = Array.from(backed);
    const seenLightIds = Array.from(new Set([...currentLight, ...currentSeen]));

    console.log(`\n=== conn ${row.id} · user ${row.user_id}`);
    console.log(`  meeting notes: ${metas.length} (backed by source_url: ${backed.size}, no source: ${noSource})`);
    console.log(`  seenFileIds:  ${currentSeen.length} -> ${seenFileIds.length}`);
    console.log(`  seenLightIds: ${currentLight.length} -> ${seenLightIds.length}`);
    console.log(`  => docs now eligible for full re-ingest = (discovered in window) - ${seenFileIds.length}`);

    if (APPLY) {
      await updateConnection(row.user_id, row.id, {
        settings: { ...settings, seenFileIds, seenLightIds },
      });
      console.log("  APPLIED");
    } else {
      console.log("  (dry-run — pass --yes to write)");
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
