/**
 * Read-only access to the owner's PUBLIC "second self" (the ohmyself! brain).
 *
 * Everything here runs server-side only and uses a public, read-only token, so
 * it can only ever surface notes the owner explicitly marked `public`. The token
 * never reaches the browser.
 *
 * Caching: the identity/project/context lookups below are wrapped in
 * `unstable_cache`, which is backed by Next's Data Cache. Unlike a module-level
 * variable (which only survives within ONE warm serverless instance), the Data
 * Cache is shared across every instance/region on Vercel — so the very common
 * "who is this / what has he built" lookups stay fast and consistent regardless
 * of which lambda a visitor happens to hit, instead of depending on cold-start
 * luck.
 */
import { unstable_cache } from "next/cache";

const API_URL = (process.env.OHMYSELF_API_URL ?? "https://ohmyself-api.vercel.app").replace(/\/+$/, "");
const TOKEN = process.env.OHMYSELF_PUBLIC_TOKEN ?? "";

// Budget for the EXTRA topic-relevant notes only (see `build()`'s
// `guaranteedCount` — identity + project overviews are always included in
// full, bypassing this cap, since both are already bounded by their own
// note-count/body-length limits and are what makes "who is this" / "what
// has he built" reliable regardless of how much identity content exists).
const MAX_CONTEXT_CHARS = 12000;
const MAX_IDENTITY_NOTES = 8;

export interface Source {
  path: string;
  title: string;
}

/** A real, citeable URL pulled from the public notes. The agent may ONLY use
 *  links from this allowlist — never invented ones. */
export interface LinkRef {
  url: string;
  label: string;
}

export interface Recall {
  text: string;
  sources: Source[];
  links: LinkRef[];
}

/** Pull http(s) URLs out of a note body (markdown or bare). */
function extractUrls(body: string): string[] {
  const out = new Set<string>();
  const re = /https?:\/\/[^\s)\]}"'<>]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    // Trim trailing punctuation that often clings to URLs in prose.
    out.add(m[0].replace(/[.,;:!?]+$/, ""));
  }
  return [...out];
}

interface Section {
  path: string;
  title: string;
  body: string;
  /** ISO date (YYYY-MM-DD) the note was last touched. Anchors any relative time
   *  words in the body ("yesterday", "last week") to WHEN it was written, so the
   *  agent never reads a 2-year-old "yesterday" as if it were now. */
  date?: string;
}

/** A short, human "freshness" hint computed against today, e.g. "~2 years ago".
 *  Returns "" for invalid/empty dates. */
function relativeAge(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 0) return "";
  if (days <= 1) return "today";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = (days / 365).toFixed(days < 730 ? 0 : 1).replace(/\.0$/, "");
  return `~${years} year${years === "1" ? "" : "s"} ago`;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    // Defense in depth: even if the token were mis-scoped, ask for public only.
    "X-Brain-Scope": "public",
  };
}

function encPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// The public identity rarely changes, so cache it in Next's shared Data Cache.
/** The owner's public identity pages (about-me, bio, etc.) — always relevant. */
const identitySections = unstable_cache(
  async (): Promise<Section[]> => {
    const list = await apiGet<{ notes?: { path: string; title: string }[] }>(
      "/v1/notes?type=identity&limit=20",
    );
    const notes = (list?.notes ?? []).slice(0, MAX_IDENTITY_NOTES);
    // Fetch the bodies in parallel rather than one-by-one.
    const fulls = await Promise.all(
      notes.map((n) =>
        apiGet<{ body?: string; meta?: { title?: string; created?: string; updated?: string } }>(
          `/v1/notes/${encPath(n.path)}`,
        ),
      ),
    );
    const sections: Section[] = [];
    notes.forEach((n, i) => {
      const body = (fulls[i]?.body ?? "").trim();
      const meta = fulls[i]?.meta;
      if (body)
        sections.push({
          path: n.path,
          title: n.title || meta?.title || n.path,
          body,
          date: meta?.updated || meta?.created,
        });
    });
    return sections;
  },
  ["ohmyself-identity-sections"],
  { revalidate: 300 },
);

// Public project overviews change rarely too — cache alongside identity.
const MAX_PROJECTS = 12;
const PROJECT_BODY_CHARS = 1100;

/** The top-level project slug a path belongs to, e.g.
 *  "projects/flowya/subprojects/flowya-ios/_index.md" -> "flowya". */
function topProjectSlug(path: string): string | null {
  const m = /^projects\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}

/** "java-household" -> "Java Household", "ohmyself" -> "Ohmyself" — a
 *  readable fallback title for a project that only exists as subprojects
 *  (no public top-level overview to borrow a title from). */
function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * The owner's public projects for context, plus a links allowlist gathered
 * from every project body (so e.g. Flowya's iOS/macOS repo links can appear
 * on its card). Links are extracted from the FULL bodies (before truncation)
 * so a URL deep in a note is never lost. Always included so "what has he
 * built?" works regardless of query wording/language.
 *
 * Two shapes of "project" become a card:
 *   1. A top-level overview: projects/<slug>/_index.md.
 *   2. An "orphan" group: projects/<slug>/subprojects/*\/_index.md when the
 *      slug has NO public top-level overview (e.g. Flowya's own _index.md is
 *      private, but its iOS/macOS subprojects are public) — these are merged
 *      into ONE synthesized card per slug rather than silently dropped.
 */
const projectBundle = unstable_cache(
  async (): Promise<{ sections: Section[]; links: LinkRef[] }> => {
    const list = await apiGet<{ notes?: { path: string; title: string }[] }>(
      "/v1/notes?type=project&limit=100",
    );
    const all = list?.notes ?? [];

    const topLevel = all.filter((n) => /^projects\/[^/]+\/_index\.md$/.test(n.path));
    const overviews = topLevel.slice(0, MAX_PROJECTS);
    const shownSlugs = new Set(overviews.map((n) => topProjectSlug(n.path)));
    const titleBySlug = new Map(overviews.map((n) => [topProjectSlug(n.path), n.title] as const));

    const allSubprojects = all.filter((n) => /^projects\/[^/]+\/subprojects\/.+\/_index\.md$/.test(n.path));
    // Subprojects of an already-shown project — harvested only for links.
    const linkOnlySubs = allSubprojects.filter((n) => shownSlugs.has(topProjectSlug(n.path)));
    // Subprojects whose parent has no public overview — grouped into their
    // own card per slug instead of being dropped.
    const orphansBySlug = new Map<string, { path: string; title: string }[]>();
    for (const n of allSubprojects) {
      const slug = topProjectSlug(n.path);
      if (!slug || shownSlugs.has(slug)) continue;
      const arr = orphansBySlug.get(slug) ?? [];
      arr.push(n);
      orphansBySlug.set(slug, arr);
    }
    const orphanList = [...orphansBySlug.values()].flat();

    const [overviewFulls, linkSubFulls, orphanFulls] = await Promise.all([
      Promise.all(
        overviews.map((n) =>
          apiGet<{ body?: string; meta?: { title?: string; created?: string; updated?: string } }>(
            `/v1/notes/${encPath(n.path)}`,
          ),
        ),
      ),
      Promise.all(linkOnlySubs.map((n) => apiGet<{ body?: string }>(`/v1/notes/${encPath(n.path)}`))),
      Promise.all(
        orphanList.map((n) =>
          apiGet<{ body?: string; meta?: { created?: string; updated?: string } }>(`/v1/notes/${encPath(n.path)}`),
        ),
      ),
    ]);
    const orphanFullByPath = new Map(orphanList.map((n, i) => [n.path, orphanFulls[i]] as const));

    const sections: Section[] = [];
    const links: LinkRef[] = [];
    const seenUrls = new Set<string>();
    const addLinks = (body: string, label: string) => {
      for (const url of extractUrls(body)) {
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        links.push({ url, label });
      }
    };

    overviews.forEach((n, i) => {
      const full = (overviewFulls[i]?.body ?? "").trim();
      if (!full) return;
      const meta = overviewFulls[i]?.meta;
      const title = n.title || meta?.title || n.path;
      addLinks(full, title); // links from the FULL body (pre-truncation)
      const body = full.length > PROJECT_BODY_CHARS ? full.slice(0, PROJECT_BODY_CHARS) + "…" : full;
      sections.push({ path: n.path, title, body, date: meta?.updated || meta?.created });
    });

    // Attribute each subproject's links to its parent project so the card matches.
    linkOnlySubs.forEach((n, i) => {
      const body = (linkSubFulls[i]?.body ?? "").trim();
      if (!body) return;
      const parentTitle = titleBySlug.get(topProjectSlug(n.path)) ?? n.title;
      addLinks(body, parentTitle);
    });

    // Orphan subprojects: merge everything under the same slug into one card.
    for (const [slug, subs] of orphansBySlug) {
      const parts = subs
        .map((n) => {
          const full = (orphanFullByPath.get(n.path)?.body ?? "").trim();
          return full ? { title: n.title, full } : null;
        })
        .filter((p): p is { title: string; full: string } => p !== null);
      if (parts.length === 0) continue;
      const title = humanizeSlug(slug);
      // Strip the redundant "<Title> " prefix from each subproject's own
      // title (e.g. "Flowya iOS" -> "iOS") so the combined body reads as ONE
      // project with parts, not several differently-titled ones — otherwise
      // the model sometimes titles the card after a subproject instead of
      // the umbrella project.
      const combined = parts
        .map((p) => {
          const stripped = p.title.toLowerCase().startsWith(title.toLowerCase() + " ")
            ? p.title.slice(title.length + 1)
            : p.title;
          return `**${stripped}:** ${p.full}`;
        })
        .join("\n\n");
      addLinks(combined, title);
      const body = combined.length > PROJECT_BODY_CHARS ? combined.slice(0, PROJECT_BODY_CHARS) + "…" : combined;
      const dates = subs
        .map((n) => orphanFullByPath.get(n.path)?.meta)
        .map((meta) => meta?.updated || meta?.created)
        .filter((d): d is string => !!d)
        .sort();
      sections.push({ path: `projects/${slug}`, title, body, date: dates[dates.length - 1] });
    }

    return { sections, links };
  },
  ["ohmyself-project-bundle"],
  { revalidate: 300 },
);

/** Topic-relevant public notes via the brain's context endpoint. Cached per
 *  (topic, limit) — repeat questions (even from different visitors, or a
 *  cold serverless instance) are served instantly instead of round-tripping
 *  to ohmyself-api and hitting whatever cold-start it's having. */
const contextSections = unstable_cache(
  async (topic: string, limit: number): Promise<Section[]> => {
    try {
      const res = await fetch(`${API_URL}/v1/context`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ topic: topic.slice(0, 400), limit }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        notes?: { path: string; title: string; body?: string; created?: string; updated?: string }[];
      };
      return (data.notes ?? [])
        .filter((n) => (n.body ?? "").trim())
        .map((n) => ({
          path: n.path,
          title: n.title,
          body: (n.body ?? "").trim(),
          date: n.updated || n.created,
        }));
    } catch {
      return [];
    }
  },
  ["ohmyself-context-sections"],
  { revalidate: 120 },
);

/** Assemble the context text. Sections are (identity, then projects, then
 *  topic matches) — but only the topic matches (index >= `guaranteedCount`)
 *  are subject to `MAX_CONTEXT_CHARS`. Identity and project overviews are
 *  always included in full: they're already bounded by their own limits
 *  (`MAX_IDENTITY_NOTES`, `MAX_PROJECTS` × `PROJECT_BODY_CHARS`), and letting
 *  a big identity note silently starve every project card (or vice versa) is
 *  worse than a slightly larger prompt. */
function build(sections: Section[], guaranteedCount = 0): Recall {
  const seen = new Set<string>();
  const parts: string[] = [];
  const sources: Source[] = [];
  const links: LinkRef[] = [];
  const seenUrls = new Set<string>();
  let total = 0;
  let overBudget = false;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (seen.has(s.path)) continue;
    seen.add(s.path);
    const guaranteed = i < guaranteedCount;
    if (!guaranteed && overBudget) continue;
    // Anchor every note in absolute time so the agent can resolve any relative
    // wording in the body and never present a stale fact as recent.
    const age = relativeAge(s.date);
    const dateLine = s.date ? ` · written/updated ${s.date}${age ? ` (${age})` : ""}` : "";
    const block = `## ${s.title}\n(${s.path})${dateLine}\n\n${s.body}`;
    if (!guaranteed && total + block.length > MAX_CONTEXT_CHARS) {
      overBudget = true;
      continue;
    }
    total += block.length;
    parts.push(block);
    sources.push({ path: s.path, title: s.title });
    // Collect any real URLs in this section, labelled by the note title.
    for (const url of extractUrls(s.body)) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      links.push({ url, label: s.title });
    }
  }
  return { text: parts.join("\n\n---\n\n"), sources, links };
}

/**
 * Gather grounding for a question: ALWAYS include the owner's public identity
 * pages (so the agent reliably knows who they are, regardless of keyword overlap
 * or query language), plus the notes most relevant to the topic.
 */
export async function recall(topic: string, limit = 6): Promise<Recall> {
  if (!TOKEN) return { text: "", sources: [], links: [] };
  const [identity, projects, ctx] = await Promise.all([
    identitySections(),
    projectBundle(),
    contextSections(topic, limit),
  ]);
  // Identity first, then projects (both guaranteed in full), then any extra
  // topic matches (deduped, and the only part actually subject to the char
  // budget — see `build()`).
  const r = build([...identity, ...projects.sections, ...ctx], identity.length + projects.sections.length);
  // Prepend the richer project links (harvested from full bodies + subprojects),
  // deduped by URL, so every project card can get its real button.
  const seen = new Set<string>();
  const links: LinkRef[] = [];
  for (const l of [...projects.links, ...r.links]) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    links.push(l);
  }
  return { ...r, links };
}

/** Grounding for the opening introduction (identity is always included). */
export async function introContext(shortName: string): Promise<Recall> {
  return recall(`${shortName} bio background work projects stories sobre mí trabajo proyectos`, 8);
}

export function brainConfigured(): boolean {
  return Boolean(TOKEN);
}

/* ────────────────────────────────────────────────────────────────────────
 * Second Self browse view (public directory + graph)
 *
 * Same public/read-only token as everything else in this file. The ohmyself
 * API itself enforces scope (`allowed = ["public"]`) server-side on every one
 * of these endpoints, so even if something here had a bug, a private/secret
 * note can never come back through it — this is just a thin, cached proxy.
 * ──────────────────────────────────────────────────────────────────────── */

export interface PublicNoteSummary {
  path: string;
  title: string;
  type: string;
  tags: string[];
  links: string[];
  created?: string;
  updated?: string;
  excerpt?: string;
}

export interface PublicNoteFull {
  path: string;
  title: string;
  type: string;
  tags: string[];
  body: string;
  created?: string;
  updated?: string;
}

export interface SemanticEdge {
  a: string;
  b: string;
  score: number;
}

const NOTES_TTL_S = 300;
const NOTE_BODY_TTL_S = 180;
const SEMANTIC_TTL_S = 600;

const getPublicNotesCached = unstable_cache(
  async (): Promise<PublicNoteSummary[]> => {
    const data = await apiGet<{
      notes?: {
        path: string;
        title: string;
        type: string;
        visibility?: string;
        tags?: string[];
        links?: string[];
        created?: string;
        updated?: string;
        excerpt?: string;
      }[];
    }>("/v1/notes?limit=300");
    return (data?.notes ?? [])
      .filter((n) => (n.visibility ?? "public") === "public")
      .map((n) => ({
        path: n.path,
        title: n.title || n.path,
        type: n.type || "note",
        tags: n.tags ?? [],
        links: n.links ?? [],
        created: n.created,
        updated: n.updated,
        excerpt: n.excerpt,
      }));
  },
  ["ohmyself-public-notes"],
  { revalidate: NOTES_TTL_S },
);

/** The full list of public notes — the raw material for the folder browser
 *  and the brain graph. Never includes private/secret notes: the public
 *  token can't see them in the first place. */
export async function listPublicNotes(): Promise<PublicNoteSummary[]> {
  if (!TOKEN) return [];
  return getPublicNotesCached();
}

const getPublicNoteCached = unstable_cache(
  async (path: string): Promise<PublicNoteFull | null> => {
    const data = await apiGet<{
      path: string;
      meta?: {
        title?: string;
        type?: string;
        visibility?: string;
        tags?: string[];
        created?: string;
        updated?: string;
      };
      body?: string;
    }>(`/v1/notes/${encPath(path)}`);
    if (!data || typeof data.body !== "string") return null;
    // Defense in depth on top of the API's own scope check.
    if (data.meta?.visibility && data.meta.visibility !== "public") return null;
    return {
      path: data.path,
      title: data.meta?.title || path,
      type: data.meta?.type || "note",
      tags: data.meta?.tags ?? [],
      body: data.body,
      created: data.meta?.created,
      updated: data.meta?.updated,
    };
  },
  ["ohmyself-public-note"],
  { revalidate: NOTE_BODY_TTL_S },
);

/** A single public note's full body, for the second-brain reader view. */
export async function readPublicNote(path: string): Promise<PublicNoteFull | null> {
  if (!TOKEN) return null;
  return getPublicNoteCached(path);
}

const getPublicSemanticCached = unstable_cache(
  async (): Promise<{ enabled: boolean; edges: SemanticEdge[] }> => {
    const data = await apiGet<{ enabled?: boolean; edges?: SemanticEdge[] }>("/v1/graph/semantic");
    return { enabled: Boolean(data?.enabled), edges: data?.edges ?? [] };
  },
  ["ohmyself-public-semantic"],
  { revalidate: SEMANTIC_TTL_S },
);

/** Embeddings-derived "idea link" edges between public notes, for the brain
 *  graph's optional layer. Best-effort — off if embeddings aren't configured. */
export async function publicSemanticEdges(): Promise<{ enabled: boolean; edges: SemanticEdge[] }> {
  if (!TOKEN) return { enabled: false, edges: [] };
  return getPublicSemanticCached();
}
