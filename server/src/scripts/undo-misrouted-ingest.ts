import "../env.js";
import { buildCore } from "../core/index.js";
import { getSpace, listSpacesForUser } from "../core/spaces.js";
import { serviceClient } from "../core/supabase.js";
import type { Note, Visibility } from "../core/types.js";

/**
 * One-off repair: pull out of a company wiki everything the old auto-router put
 * there by mistake.
 *
 * Until ingest stopped auto-routing, a single distill call could decide a meeting
 * belonged to a company space and then write the WHOLE ingest there — the meeting
 * note plus its people, projects and commitments. Those meeting notes are stamped
 * `routed_space: <slug>` in their frontmatter, which anchors everything below.
 *
 * Work is grouped by SOURCE DOC, because that is what identity means here: the
 * same Drive transcript re-distilled twice produces differently-worded notes at
 * different paths, so comparing paths across spaces says nothing. A cluster whose
 * source doc was also ingested into the owner's own space is a duplicate and can
 * go; a cluster that only ever landed in the company wiki is the only copy, and
 * is reported so it can be re-ingested into the self space first (see
 * reingest-drive-doc.ts) rather than deleted.
 *
 *   tsx src/scripts/undo-misrouted-ingest.ts --space bonds [--yes]
 */

const ALLOWED: Visibility[] = ["public", "private", "secret"];

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const APPLY = process.argv.includes("--yes");

/** One misrouted source doc and everything ingest wrote from it. */
interface Cluster {
  meetingPath: string;
  sourceUrl: string | null;
  /** The same Drive doc was also ingested into the owner's own space. */
  inSelf: boolean;
}

interface Candidate {
  path: string;
  why: string;
  /** Source docs this note carries facts from. */
  clusters: Set<string>;
}

/** A person/project page is safe to drop only if EVERY line of content came from
 *  a misrouted source: a headline (`> role`) plus dated facts citing those URLs.
 *  Anything else means real company knowledge lives on the page too. */
function onlyMisroutedContent(body: string, sources: Set<string>): boolean {
  let sawMisrouted = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(">")) continue;
    const urls = [...line.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]);
    if (urls.length === 0 || !urls.every((u) => sources.has(u))) return false;
    sawMisrouted = true;
  }
  return sawMisrouted;
}

type BrainRef = ReturnType<typeof buildCore>["brain"];

/** Read notes a batch at a time — one-by-one over a few thousand storage objects
 *  takes minutes. */
async function readAll(brain: BrainRef, spaceId: string, paths: string[]): Promise<Map<string, Note>> {
  const out = new Map<string, Note>();
  const CONCURRENCY = 24;
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY);
    const notes = await Promise.all(
      batch.map((p) => brain.readNote(spaceId, p, ALLOWED).catch(() => null)),
    );
    notes.forEach((n, j) => {
      if (n) out.set(batch[j]!, n);
    });
  }
  return out;
}

function sourceUrlOf(note: Note | undefined): string | null {
  const url = note?.meta.extra?.source_url;
  return typeof url === "string" ? url : null;
}

async function main(): Promise<void> {
  const slug = argFor("--space");
  if (!slug) throw new Error("pass --space <company-slug>");

  const sb = serviceClient();
  const { data, error } = await sb.from("spaces").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  const company = data ? await getSpace((data as { id: string }).id) : null;
  if (!company || company.kind !== "company") throw new Error(`no company space with slug "${slug}"`);

  // The owner's personal brain — where the originals should have landed.
  const owned = await listSpacesForUser(company.ownerUserId);
  const selfSpace = owned.find((s) => s.kind === "self");
  if (!selfSpace) throw new Error(`owner ${company.ownerUserId} has no self space`);

  const { brain, vault } = buildCore();
  const companyPaths = await vault.listPaths(company.id);
  const selfPaths = await vault.listPaths(selfSpace.id);

  const selfMeetings = await readAll(brain, selfSpace.id, selfPaths.filter((p) => p.startsWith("meetings/")));
  const selfSources = new Set(
    [...selfMeetings.values()].map(sourceUrlOf).filter((u): u is string => u !== null),
  );

  const companyNotes = await readAll(brain, company.id, companyPaths);

  // 1. The anchor: meetings the router claimed for this company.
  const clusters = new Map<string, Cluster>();
  const misroutedUrls = new Set<string>();
  const urlToCluster = new Map<string, string>();
  for (const [p, note] of companyNotes) {
    if (!p.startsWith("meetings/") || note.meta.extra?.routed_space !== slug) continue;
    const url = sourceUrlOf(note);
    clusters.set(p, { meetingPath: p, sourceUrl: url, inSelf: url ? selfSources.has(url) : false });
    if (url) {
      misroutedUrls.add(url);
      urlToCluster.set(url, p);
    }
  }

  if (clusters.size === 0) {
    console.log(`No notes stamped routed_space=${slug}. Nothing to undo.`);
    return;
  }

  // 2. Everything else ingest wrote in the same passes.
  const candidates: Candidate[] = [...clusters.keys()].map((p) => ({
    path: p,
    why: "misrouted meeting",
    clusters: new Set([p]),
  }));
  const mixed: string[] = [];
  // Which misrouted meetings link a given note — the only trail back for pages
  // that carry no source URL of their own.
  const linkedFrom = new Map<string, Set<string>>();
  for (const p of clusters.keys()) {
    for (const l of companyNotes.get(p)?.meta.links ?? []) {
      const set = linkedFrom.get(l) ?? new Set<string>();
      set.add(p);
      linkedFrom.set(l, set);
    }
  }

  for (const [p, note] of companyNotes) {
    if (clusters.has(p)) continue;

    if (p.startsWith("commitments/")) {
      const from = /-\s+\*\*From:\*\*\s+(\S+)/.exec(note.body)?.[1];
      if (from && clusters.has(from)) {
        candidates.push({ path: p, why: `commitment from ${from}`, clusters: new Set([from]) });
      }
      continue;
    }

    if (!p.startsWith("people/") && !p.startsWith("projects/")) continue;

    const cited = [...misroutedUrls].filter((u) => note.body.includes(u));
    if (cited.length > 0) {
      if (onlyMisroutedContent(note.body, misroutedUrls)) {
        candidates.push({
          path: p,
          why: "only misrouted facts",
          clusters: new Set(cited.map((u) => urlToCluster.get(u)!)),
        });
      } else {
        mixed.push(p);
      }
      continue;
    }

    // Projects get appended without a source link, so the only trail back is the
    // misrouted meeting that links them.
    const linkers = linkedFrom.get(p);
    if (p.startsWith("projects/") && linkers?.size) {
      candidates.push({
        path: p,
        why: `project only linked from ${[...linkers].join(", ")}`,
        clusters: new Set(linkers),
      });
    }
  }

  // 3. Only delete when every source doc behind a note is also in the self space.
  const dupes = candidates.filter((c) => [...c.clusters].every((k) => clusters.get(k)?.inSelf));
  const onlyCopies = candidates.filter((c) => !dupes.includes(c));

  console.log(`Space "${slug}" (${company.id}) — owner self space ${selfSpace.id}`);
  console.log(`\n${clusters.size} misrouted source doc(s), ${candidates.length} note(s) written from them:`);
  for (const c of clusters.values()) {
    console.log(`  ${c.inSelf ? "dup " : "ONLY"}  ${c.meetingPath}`);
  }

  console.log(`\nSAFE TO DELETE — source doc also ingested in the self space (${dupes.length}):`);
  for (const c of dupes) console.log(`  - ${c.path}  [${c.why}]`);

  if (onlyCopies.length) {
    console.log(
      `\nSKIPPED — only copy: re-ingest the source doc into the self space first (${onlyCopies.length}):`,
    );
    for (const c of onlyCopies) console.log(`  - ${c.path}  [${c.why}]`);
  }
  if (mixed.length) {
    console.log(`\nSKIPPED — needs a human edit, not a delete (${mixed.length}):`);
    for (const p of mixed) console.log(`  - ${p}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --yes to delete the SAFE list.");
    return;
  }

  let deleted = 0;
  for (const c of dupes) {
    try {
      await brain.deleteNote(company.id, c.path, ALLOWED);
      deleted++;
    } catch (err) {
      console.error(`  ✗ ${c.path}: ${(err as Error).message}`);
    }
  }
  console.log(`\nDeleted ${deleted}/${dupes.length} note(s) from "${slug}".`);
}

main().catch((err) => {
  console.error("undo-misrouted-ingest failed:", err);
  process.exit(1);
});
