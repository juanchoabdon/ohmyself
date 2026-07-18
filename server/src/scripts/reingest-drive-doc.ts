/** Re-ingest specific Drive docs by name match, even if already "seen".
 *  Usage: tsx reingest-drive-doc.ts <name-substring> [--dry-run]
 */
import "../env.js";
import {
  allowedVisibilities,
  buildCore,
  getConnectionWithCredential,
  getSpaceConfig,
  ingest,
} from "../core/index.js";
import { refreshAccessToken } from "../connectors/google-auth.js";
import {
  discoverGeminiNotes,
  exportDocText,
  normalizeGeminiName,
} from "../connectors/google-drive-meetings.js";

const spaceId = "50e99419-6adb-45bf-9e49-9235c990444e";
const connectionId = "555dc137-8a5b-4c41-9c7a-2525e68a42c4";
const match = (process.argv[2] ?? "Training AI-native").toLowerCase();
const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const conn = await getConnectionWithCredential(spaceId, connectionId);
  if (!conn) throw new Error("connection not found");
  const { accessToken } = await refreshAccessToken(conn.credential);

  const candidates = await discoverGeminiNotes(accessToken, { lookbackMonths: 2, max: 500 });
  const targets = candidates.filter((c) => c.name.toLowerCase().includes(match));
  console.log(`${targets.length} doc(s) matching "${match}":`);
  for (const t of targets) console.log(" -", t.name, `(${t.id})`);
  if (dryRun || targets.length === 0) return;

  const { brain } = buildCore();
  const config = await getSpaceConfig(spaceId);
  const allowed = allowedVisibilities("secret");

  for (const c of targets) {
    const { title } = normalizeGeminiName(c.name);
    console.log(`\n=== ingesting: ${c.name} ===`);
    try {
      const rawText = await exportDocText(accessToken, c.id);
      console.log(`exported ${rawText.length} chars`);
      const r = await ingest(brain, spaceId, config, allowed, {
        kind: "meeting",
        rawText,
        title,
        date: (c.createdTime ?? c.modifiedTime ?? "").slice(0, 10) || undefined,
        sourceUrl: c.webViewLink ?? `https://drive.google.com/open?id=${c.id}`,
        mode: "full",
        visibility: "private",
      });
      console.log(
        `outcome: ${r.isNoise ? "NOISE" : "ok"} | meeting=${r.meetingPath ?? "-"} | touched=${r.touched.length} | commitments=${r.commitments.length}`,
      );
      if (r.distilled?.summary) console.log("summary:", r.distilled.summary.slice(0, 200));
    } catch (err) {
      console.error("FAILED:", (err as Error).message.slice(0, 500));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
