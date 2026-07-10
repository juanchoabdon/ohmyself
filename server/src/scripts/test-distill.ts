import "../env.js";
import { distill } from "../core/distill.js";
import { allowedVisibilities, buildCore, getConnectionWithCredential, listConnections } from "../core/index.js";
import { GOOGLE_DRIVE_MEETINGS_PROVIDER, refreshAccessToken } from "../connectors/google-auth.js";
import { exportDocText } from "../connectors/google-drive-meetings.js";

const userId = "50e99419-6adb-45bf-9e49-9235c990444e";
const MEETING = "meetings/2026-07-09-simplifying-mobile-arch-follow-up.md";

async function main(): Promise<void> {
  const { brain } = buildCore();
  const note = await brain.readNote(userId, MEETING, allowedVisibilities("secret"));
  const url = String(note.meta.extra?.source_url ?? "");
  const fileId = url.match(/\/d\/([-\w]+)/)?.[1] ?? url.match(/[?&]id=([-\w]+)/)?.[1];
  console.log("source_url:", url, "\nfileId:", fileId);
  if (!fileId) throw new Error("no fileId");

  const conns = await listConnections(userId, GOOGLE_DRIVE_MEETINGS_PROVIDER);
  const conn = await getConnectionWithCredential(userId, conns[0]!.id);
  const { accessToken } = await refreshAccessToken(conn!.credential);
  const rawText = await exportDocText(accessToken, fileId);
  console.log("doc chars:", rawText.length, "· MODEL:", process.env.OPENAI_MODEL || "(default gpt-4o-mini)");

  const r = await distill({
    rawText,
    kind: "meeting",
    mode: "full",
    title: "Simplifying Mobile Arch - Follow Up",
    grounding: { people: [], projects: [] },
  });
  console.log("\nsummary chars:", r.summary.length);
  console.log("action_items:", r.action_items.length);
  console.log(JSON.stringify(r.action_items, null, 2));
  console.log("\nproject_updates:", r.project_updates.length);
  console.log("resolves:", r.resolves.length, "· entity_updates:", r.entity_updates.length);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
