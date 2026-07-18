/** Inspect a connection's seen ledgers + recent meeting notes in its space. */
import "../env.js";
import { serviceClient } from "../core/supabase.js";
import { buildCore } from "../core/index.js";

const spaceId = process.argv[2] ?? "50e99419-6adb-45bf-9e49-9235c990444e";
const connectionId = process.argv[3] ?? "555dc137-8a5b-4c41-9c7a-2525e68a42c4";

async function main(): Promise<void> {
  const { data, error } = await serviceClient()
    .from("connections")
    .select("settings, last_sync_at, status")
    .eq("id", connectionId)
    .single();
  if (error) throw new Error(error.message);
  const settings = (data.settings ?? {}) as Record<string, unknown>;
  const seenFull = (settings.seenFileIds as string[]) ?? [];
  const seenLight = (settings.seenLightIds as string[]) ?? [];
  console.log(`status=${data.status} last_sync=${data.last_sync_at}`);
  console.log(`seenFileIds=${seenFull.length} seenLightIds=${seenLight.length}`);
  const bf = settings.backfill as Record<string, unknown> | undefined;
  if (bf) {
    console.log("backfill:", JSON.stringify({ ...bf, recent: undefined }));
    for (const it of ((bf.recent as unknown[]) ?? []).slice(0, 8)) {
      console.log("  recent:", JSON.stringify(it));
    }
  }

  const { brain } = buildCore();
  const notes = await brain.listNotes(spaceId, {
    prefix: "meetings/",
    allowed: ["public", "private", "secret"],
    limit: 5000,
  });
  const sorted = notes
    .slice()
    .sort((a, b) => String(b.path).localeCompare(String(a.path)))
    .slice(0, 15);
  console.log(`\nlatest meeting notes in space (${notes.length} total):`);
  for (const n of sorted) console.log(" -", n.path, "|", n.title);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
