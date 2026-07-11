/**
 * Generate evaluation cases grounded in REAL notes, to grow the retrieval
 * benchmark toward the 100-200 cases the spec requires before deprecating the
 * lexical path.
 *
 * For a diverse sample of notes across folders, a cheap LLM (route tier) writes
 * ONE natural question the note answers — deliberately phrased in the owner's
 * words, avoiding the note's exact title/keywords so the case exercises SEMANTIC
 * matching, not just lexical overlap. Each case's expected_path is the source
 * note. Output is written to eval/brain-retrieval-corpus.generated.json (kept
 * separate from the curated seed) and merged in by eval-retrieval.ts.
 *
 *   tsx src/scripts/gen-eval-corpus.ts --space <spaceId> --count 80
 */
import "../env.js";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedVisibilities, buildCore } from "../core/index.js";
import { chatJSON, llmEnabled } from "../core/llm.js";

interface GenCase {
  id: string;
  question: string;
  expected_paths: string[];
  expected_route: string;
  difficulty: string;
  source_title: string;
}

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Folders that make good, stable eval targets (durable knowledge, not logs).
const FOLDER_ALLOW = ["projects", "people", "identity", "goals", "concepts", "glossary", "notes", "areas"];
// Folders to skip (noisy, ephemeral, or derived).
const FOLDER_SKIP = ["lint", "todos", "memory", "journal", "meetings", "skills"];

function topFolder(p: string): string {
  return p.split("/")[0] || "(root)";
}

async function main(): Promise<void> {
  const spaceId = argFor("--space");
  if (!spaceId) throw new Error("--space <spaceId> is required");
  if (!llmEnabled()) throw new Error("OPENAI_API_KEY required to generate cases");
  const count = Number(argFor("--count") ?? "80") || 80;

  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");

  const all = await brain.listNotes(spaceId, { allowed, limit: 4000 });
  const eligible = all.filter(
    (n) =>
      !FOLDER_SKIP.includes(topFolder(n.path)) &&
      FOLDER_ALLOW.includes(topFolder(n.path)) &&
      (n.excerpt?.length ?? 0) > 60,
  );

  // Bucket by folder, then round-robin so the corpus spans the whole brain.
  const buckets = new Map<string, typeof eligible>();
  for (const n of eligible) {
    const f = topFolder(n.path);
    (buckets.get(f) ?? buckets.set(f, []).get(f)!).push(n);
  }
  for (const arr of buckets.values()) arr.sort(() => Math.random() - 0.5);
  const order: typeof eligible = [];
  let added = true;
  while (added && order.length < count * 2) {
    added = false;
    for (const arr of buckets.values()) {
      const next = arr.shift();
      if (next) {
        order.push(next);
        added = true;
      }
    }
  }

  console.log(`Sampling from ${eligible.length} eligible notes across ${buckets.size} folders; target ${count} cases.\n`);

  const cases: GenCase[] = [];
  const seenPaths = new Set<string>();
  for (const n of order) {
    if (cases.length >= count) break;
    if (seenPaths.has(n.path)) continue;
    let note;
    try {
      note = await brain.readNote(spaceId, n.path, allowed);
    } catch {
      continue;
    }
    const body = note.body.slice(0, 2500);
    if (body.trim().length < 80) continue;

    const out = await chatJSON<{ question: string; difficulty: string; route: string; ok: boolean }>({
      tier: "route",
      timeoutMs: 20000,
      system: [
        "You build a retrieval benchmark for a personal second-brain.",
        "Given ONE note, write ONE natural question whose answer is IN this note.",
        "Rules: phrase it as the owner would casually ask; avoid reusing the note's",
        "distinctive keywords/phrasing verbatim (force semantic matching, not mere",
        "keyword overlap). CRITICAL: the question must be UNIQUELY answerable by THIS",
        "note — not by many similar notes. If the note is about a specific person,",
        "project, or company, KEEP that subject's NAME in the question (real questions",
        "name their subject; stripping it makes the case ambiguous). Only avoid the",
        "note's other distinctive wording. If the note is too thin/junk or you can't",
        "make a uniquely-answerable question, set ok=false.",
        'Return STRICT JSON: {"question": string, "difficulty":',
        '"direct"|"semantic_mismatch"|"multi_hop", "route": "fast_recall"|"deep_research",',
        '"ok": boolean}.',
      ].join(" "),
      user: `NOTE PATH: ${note.path}\nTITLE: ${note.meta.title}\n\nBODY:\n${body}`,
    });
    if (!out || !out.ok || !out.question?.trim()) {
      process.stdout.write("x");
      continue;
    }
    seenPaths.add(n.path);
    cases.push({
      id: `gen-${n.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60)}`,
      question: out.question.trim(),
      expected_paths: [n.path],
      expected_route: out.route === "deep_research" ? "deep_research" : "fast_recall",
      difficulty: ["direct", "semantic_mismatch", "multi_hop"].includes(out.difficulty) ? out.difficulty : "direct",
      source_title: note.meta.title,
    });
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(here, "..", "eval", "brain-retrieval-corpus.generated.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        about:
          "AUTO-GENERATED eval cases (gen-eval-corpus.ts): one LLM-authored question per real note, phrased to avoid keyword overlap. Merged with the curated seed by eval-retrieval.ts. Regenerate anytime; review/prune before treating as a release gate.",
        generated_at: new Date().toISOString(),
        cases,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${cases.length} cases -> ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("gen-eval-corpus failed:", e);
    process.exit(1);
  });
