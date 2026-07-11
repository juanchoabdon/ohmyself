/**
 * Run the Brain retrieval evaluation corpus against a real space and report
 * recall@k, coverage distribution, and latency. Compares hybrid vs lexical-only
 * so we can prove the new path is better before deprecating the old one.
 *
 *   tsx src/scripts/eval-retrieval.ts --space <spaceId>          # hybrid (default)
 *   tsx src/scripts/eval-retrieval.ts --space <spaceId> --k 5
 *   tsx src/scripts/eval-retrieval.ts --space <spaceId> --lexical  # force old path
 */
import "../env.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedVisibilities, buildCore } from "../core/index.js";

interface Case {
  id: string;
  question: string;
  expected_paths: string[];
  expected_route?: string;
  difficulty?: string;
}

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const spaceId = argFor("--space");
  if (!spaceId) throw new Error("--space <spaceId> is required");
  const k = Number(argFor("--k") ?? "6") || 6;
  const lexicalOnly = hasFlag("--lexical");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const corpusPath = path.resolve(here, "..", "eval", "brain-retrieval-corpus.json");
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { cases: Case[] };

  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");

  console.log(
    `Eval retrieval — space=${spaceId} k=${k} mode=${lexicalOnly ? "lexical-only" : "hybrid"} cases=${corpus.cases.length}\n`,
  );

  let hits = 0;
  const coverage = { high: 0, medium: 0, low: 0 };
  let totalMs = 0;

  for (const c of corpus.cases) {
    const t0 = Date.now();
    // getContext runs through hybrid (with lexical fallback). For a pure-lexical
    // baseline, hit the index search directly.
    const results = lexicalOnly
      ? { sources: (await brain.lexicalSearch(spaceId, c.question, { allowed, limit: k })).map((n) => ({ path: n.path })), coverage: "n/a" as const }
      : await brain.getContext(spaceId, c.question, allowed, k);
    const ms = Date.now() - t0;
    totalMs += ms;

    const got = results.sources.map((s) => s.path).slice(0, k);
    const found = c.expected_paths.some((p) => got.includes(p));
    if (found) hits += 1;
    if (
      !lexicalOnly &&
      (results.coverage === "high" || results.coverage === "medium" || results.coverage === "low")
    ) {
      coverage[results.coverage] += 1;
    }

    const rank = got.findIndex((p) => c.expected_paths.includes(p));
    console.log(
      `${found ? "PASS" : "FAIL"}  ${c.id}  (${ms}ms${lexicalOnly ? "" : `, cov=${results.coverage}`}${rank >= 0 ? `, rank=${rank + 1}` : ""})`,
    );
    if (!found) {
      console.log(`      q: ${c.question}`);
      console.log(`      expected: ${c.expected_paths.join(", ")}`);
      console.log(`      got: ${got.slice(0, 5).join(", ") || "(none)"}`);
    }
  }

  const n = corpus.cases.length;
  console.log(`\nrecall@${k}: ${hits}/${n} = ${((hits / n) * 100).toFixed(1)}%`);
  if (!lexicalOnly) {
    console.log(`coverage: high=${coverage.high} medium=${coverage.medium} low=${coverage.low}`);
  }
  console.log(`avg latency: ${(totalMs / n).toFixed(0)}ms`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("eval-retrieval failed:", e);
    process.exit(1);
  });
