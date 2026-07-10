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
  const mp = "meetings/2026-07-09-simplifying-mobile-arch-follow-up.md";
  const forMeeting = await brain.listNotes(userId, { types: ["commitment"], allowed, limit: 500 });
  const linked = [] as string[];
  for (const r of forMeeting) {
    const note = await brain.readNote(userId, r.path, allowed);
    if (note.meta.extra?.source === mp || String(note.meta.extra?.source_url ?? "").includes("1TlTCNJTwgeYv4WQyeTvctFI")) linked.push(r.path);
  }
  console.log(`commitments for ${mp}:`, linked.length, linked);

  const note = await brain.readNote(userId, mp, allowed).catch(() => null);
  console.log("\nmeeting links:", note?.meta.links);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
