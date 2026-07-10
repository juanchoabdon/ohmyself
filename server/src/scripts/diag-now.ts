import "../env.js";
import { serviceClient } from "../core/supabase.js";
import { allowedVisibilities, buildCore, getConnectionWithCredential, listConnections } from "../core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER } from "../connectors/google-auth.js";

async function main(): Promise<void> {
  const userId = "50e99419-6adb-45bf-9e49-9235c990444e";
  const sb = serviceClient();
  const raw = await sb.from("note_index").select("path", { count: "exact", head: true }).eq("user_id", userId).like("path", "meetings/%");
  console.log("raw meetings rows:", raw.count);

  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const fc = (await brain.folderCounts(userId, allowed)) as Array<{ folder: string; count: number }>;
  console.log("folderCounts[meetings]:", fc.find((f) => f.folder === "meetings")?.count);

  const conns = await listConnections(userId, GOOGLE_DRIVE_MEETINGS_PROVIDER);
  const c = conns[0] ? await getConnectionWithCredential(userId, conns[0].id) : null;
  const bf = c?.settings?.backfill;
  console.log("backfill:", bf ? JSON.stringify({ status: bf.status, done: bf.done, total: bf.total, current: bf.current, lastStepAt: bf.lastStepAt }) : "none");

  const com = await sb.from("note_index").select("path", { count: "exact", head: true }).eq("user_id", userId).eq("type", "commitment");
  console.log("total commitment notes:", com.count);
  const day = await sb.from("note_index").select("path,tags").eq("user_id", userId).like("path", "commitments/2026-07-09-%");
  const rows = (day.data as Array<{ path: string; tags: string[] }> | null) ?? [];
  console.log(`\ncommitments dated 2026-07-09: ${rows.length}`);
  for (const r of rows) console.log("  ", r.path);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
