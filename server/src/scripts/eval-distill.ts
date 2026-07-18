/**
 * Evaluate meeting distillation quality against known Bonds cases (DW, WOW).
 *
 *   tsx src/scripts/eval-distill.ts --case dw [--dry-run]
 *   tsx src/scripts/eval-distill.ts --case wow --raw-file /path/to/transcript.txt
 *   tsx src/scripts/eval-distill.ts --all
 *
 * Fetches raw text from Google Drive when --space + --connection are set,
 * otherwise uses --raw-file or exports via doc id from eval/distill-cases.json.
 */
import "../env.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowedVisibilities,
  distill,
  distillEnabled,
  distillModelForTier,
  getConnectionWithCredential,
  shouldRichDistill,
  listSpacesForUser,
} from "../core/index.js";
import { refreshAccessToken } from "../connectors/google-auth.js";
import { exportDocText } from "../connectors/google-drive-meetings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, "../../eval/distill-cases.json");

interface DistillCase {
  id: string;
  title: string;
  date: string;
  drive_doc_id?: string;
  expected_space: string;
  expected_concepts: string[] | string[][];
  expected_decisions_min: number;
  expected_insights_min: number;
  expected_models_min: number;
}

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function haystack(result: Awaited<ReturnType<typeof distill>>): string {
  return norm(
    [
      result.summary,
      ...result.insights,
      ...result.decisions.map((d) => d.text),
      ...result.open_questions,
      ...result.conceptual_models.map((m) => `${m.name} ${m.description}`),
      ...result.action_items.map((a) => a.text),
    ].join(" "),
  );
}

function scoreConcepts(
  result: Awaited<ReturnType<typeof distill>>,
  expected: string[] | string[][],
): {
  hit: string[];
  miss: string[];
  rate: number;
} {
  const text = haystack(result);
  const groups = expected.map((e) => (Array.isArray(e) ? e : [e]));
  const hit: string[] = [];
  const miss: string[] = [];
  for (const aliases of groups) {
    const label = aliases[0]!;
    const matched = aliases.some((a) => text.includes(norm(a)));
    if (matched) hit.push(label);
    else miss.push(label);
  }
  return { hit, miss, rate: groups.length ? hit.length / groups.length : 1 };
}

function groupsCount(expected: string[] | string[][]): number {
  return expected.map((e) => (Array.isArray(e) ? e : [e])).length;
}

async function loadRawText(c: DistillCase): Promise<string> {
  const rawFile = argFor("--raw-file");
  if (rawFile) return readFileSync(rawFile, "utf8");

  const spaceId = argFor("--space");
  const connectionId = argFor("--connection");
  if (spaceId && connectionId && c.drive_doc_id) {
    const conn = await getConnectionWithCredential(spaceId, connectionId);
    if (!conn) throw new Error("connection not found");
    const { accessToken } = await refreshAccessToken(conn.credential);
    return exportDocText(accessToken, c.drive_doc_id);
  }

  throw new Error(
    `No raw text for case "${c.id}". Pass --raw-file or --space + --connection with drive_doc_id.`,
  );
}

async function runCase(c: DistillCase, ownerUserId: string): Promise<void> {
  console.log(`\n=== CASE: ${c.id.toUpperCase()} (${c.title}) ===`);
  const rawText = await loadRawText(c);
  console.log(`raw chars: ${rawText.length}`);

  const allowed = allowedVisibilities("secret");
  const spaces = await listSpacesForUser(ownerUserId);
  const companySpaces = spaces
    .filter((s) => s.kind === "company" && s.slug)
    .map((s) => ({ slug: s.slug!, name: s.name }));

  const input = {
    rawText,
    kind: "meeting" as const,
    mode: "full" as const,
    title: c.title,
    date: c.date,
    forceRich: true,
    grounding: {
      owner: "Founder building Bonds (AI-native messaging) and VP Product at Rappi.",
      ownerNames: ["Juan Diego Sanchez", "juan.sanchez@rappi.com"],
      people: ["Miguel Angel Avila", "Juan Sebastian Becerra", "Daniel Murte"],
      projects: ["Bonds"],
      concepts: [],
      openCommitments: [],
      companySpaces,
    },
  };

  const tier = shouldRichDistill(input) ? "rich" : "standard";
  console.log(`tier: ${tier} (model: ${distillModelForTier(tier)})`);

  const t0 = Date.now();
  const result = await distill(input);
  console.log(`distill: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const concepts = scoreConcepts(result, c.expected_concepts);
  const routingOk =
    result.routing?.target_space === "company" &&
    result.routing.company_slug === c.expected_space &&
    (result.routing.confidence ?? 0) >= 0.85;

  console.log("\n--- synthesis ---");
  console.log("summary:", result.summary.slice(0, 280) + (result.summary.length > 280 ? "…" : ""));
  console.log(`insights: ${result.insights.length} | decisions: ${result.decisions.length} | models: ${result.conceptual_models.length}`);
  console.log(`open questions: ${result.open_questions.length} | actions: ${result.action_items.length}`);

  if (result.conceptual_models.length) {
    console.log("\nmodels:");
    for (const m of result.conceptual_models) console.log(`  - ${m.name}`);
  }

  console.log("\n--- routing ---");
  console.log(result.routing ?? "(none)");

  console.log("\n--- coverage ---");
  console.log(result.coverage ?? "(none)");

  console.log("\n--- concept recall ---");
  console.log(`hit ${concepts.hit.length}/${groupsCount(c.expected_concepts)} (${(concepts.rate * 100).toFixed(0)}%)`);
  if (concepts.hit.length) console.log("  ✓", concepts.hit.join(", "));
  if (concepts.miss.length) console.log("  ✗", concepts.miss.join(", "));

  const checks = [
    { name: "insights_min", ok: result.insights.length >= c.expected_insights_min },
    { name: "decisions_min", ok: result.decisions.length >= c.expected_decisions_min },
    { name: "models_min", ok: result.conceptual_models.length >= c.expected_models_min },
    { name: "concept_recall_60", ok: concepts.rate >= 0.6 },
    { name: "routing_bonds", ok: routingOk },
    { name: "coverage_70", ok: (result.coverage?.score ?? 0) >= 0.7 },
  ];

  console.log("\n--- pass/fail ---");
  let pass = true;
  for (const ch of checks) {
    const mark = ch.ok ? "PASS" : "FAIL";
    if (!ch.ok) pass = false;
    console.log(`  ${mark}  ${ch.name}`);
  }
  console.log(pass ? "\n✅ CASE PASSED" : "\n❌ CASE FAILED");

  if (argFor("--json")) {
    console.log(JSON.stringify({ case: c.id, pass, result, concepts }, null, 2));
  }
}

async function main(): Promise<void> {
  if (!distillEnabled()) throw new Error("OPENAI_API_KEY required");

  const cases = JSON.parse(readFileSync(CASES_PATH, "utf8")) as DistillCase[];
  const caseId = argFor("--case");
  const all = process.argv.includes("--all");
  const ownerUserId = argFor("--owner") ?? "50e99419-6adb-45bf-9e49-9235c990444e";

  const selected = all ? cases : cases.filter((c) => c.id === caseId);
  if (!selected.length) {
    console.error("Usage: eval-distill.ts --case dw|wow | --all");
    console.error("  [--space <id> --connection <id>] or [--raw-file path]");
    process.exit(1);
  }

  for (const c of selected) {
    await runCase(c, ownerUserId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
