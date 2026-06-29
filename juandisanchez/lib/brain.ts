/**
 * Read-only access to the owner's PUBLIC "second self" (the ohmyself! brain).
 *
 * Everything here runs server-side only and uses a public, read-only token, so
 * it can only ever surface notes the owner explicitly marked `public`. The token
 * never reaches the browser.
 */

const API_URL = (process.env.OHMYSELF_API_URL ?? "https://ohmyself-api.vercel.app").replace(/\/+$/, "");
const TOKEN = process.env.OHMYSELF_PUBLIC_TOKEN ?? "";

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

// The public identity rarely changes, so cache it briefly. This removes the
// brain round-trips (and any Vercel cold-start) from most requests.
const IDENTITY_TTL_MS = 60_000;
let identityCache: { at: number; data: Section[] } | null = null;

/** The owner's public identity pages (about-me, bio, etc.) — always relevant. */
async function identitySections(): Promise<Section[]> {
  if (identityCache && Date.now() - identityCache.at < IDENTITY_TTL_MS) {
    return identityCache.data;
  }
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
  if (sections.length) identityCache = { at: Date.now(), data: sections };
  return sections;
}

// Public project overviews change rarely too — cache alongside identity.
const PROJECT_TTL_MS = 60_000;
const MAX_PROJECTS = 12;
const PROJECT_BODY_CHARS = 1100;
let projectCache: { at: number; data: { sections: Section[]; links: LinkRef[] } } | null = null;

/** The top-level project slug a path belongs to, e.g.
 *  "projects/flowya/subprojects/flowya-ios/_index.md" -> "flowya". */
function topProjectSlug(path: string): string | null {
  const m = /^projects\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}

/**
 * The owner's TOP-LEVEL public projects (projects/<slug>/_index.md) for context,
 * plus a links allowlist gathered from each project AND its public subprojects
 * (so e.g. Flowya's iOS/macOS repo links can appear on the Flowya card). Links
 * are extracted from the FULL bodies (before truncation) so a URL deep in a note
 * is never lost. Always included so "what has he built?" works regardless of
 * query wording/language.
 */
async function projectBundle(): Promise<{ sections: Section[]; links: LinkRef[] }> {
  if (projectCache && Date.now() - projectCache.at < PROJECT_TTL_MS) {
    return projectCache.data;
  }
  const list = await apiGet<{ notes?: { path: string; title: string }[] }>(
    "/v1/notes?type=project&limit=100",
  );
  const all = list?.notes ?? [];
  // Top-level overviews (these become context + project cards).
  const overviews = all
    .filter((n) => /^projects\/[^/]+\/_index\.md$/.test(n.path))
    .slice(0, MAX_PROJECTS);
  const shownSlugs = new Set(overviews.map((n) => topProjectSlug(n.path)));
  const titleBySlug = new Map(overviews.map((n) => [topProjectSlug(n.path), n.title] as const));
  // Public subprojects of the shown projects — used only to harvest their links.
  const subprojects = all.filter(
    (n) =>
      /^projects\/[^/]+\/subprojects\/.+\/_index\.md$/.test(n.path) &&
      shownSlugs.has(topProjectSlug(n.path)),
  );

  const [overviewFulls, subFulls] = await Promise.all([
    Promise.all(
      overviews.map((n) =>
        apiGet<{ body?: string; meta?: { title?: string; created?: string; updated?: string } }>(
          `/v1/notes/${encPath(n.path)}`,
        ),
      ),
    ),
    Promise.all(
      subprojects.map((n) => apiGet<{ body?: string }>(`/v1/notes/${encPath(n.path)}`)),
    ),
  ]);

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
  subprojects.forEach((n, i) => {
    const body = (subFulls[i]?.body ?? "").trim();
    if (!body) return;
    const parentTitle = titleBySlug.get(topProjectSlug(n.path)) ?? n.title;
    addLinks(body, parentTitle);
  });

  const data = { sections, links };
  if (sections.length) projectCache = { at: Date.now(), data };
  return data;
}

/** Topic-relevant public notes via the brain's context endpoint. */
async function contextSections(topic: string, limit: number): Promise<Section[]> {
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
}

function build(sections: Section[]): Recall {
  // Dedupe by path, preserving order (identity first, then topic matches).
  const seen = new Set<string>();
  const parts: string[] = [];
  const sources: Source[] = [];
  const links: LinkRef[] = [];
  const seenUrls = new Set<string>();
  let total = 0;
  for (const s of sections) {
    if (seen.has(s.path)) continue;
    seen.add(s.path);
    // Anchor every note in absolute time so the agent can resolve any relative
    // wording in the body and never present a stale fact as recent.
    const age = relativeAge(s.date);
    const dateLine = s.date ? ` · written/updated ${s.date}${age ? ` (${age})` : ""}` : "";
    const block = `## ${s.title}\n(${s.path})${dateLine}\n\n${s.body}`;
    if (total + block.length > MAX_CONTEXT_CHARS) break;
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
  // Identity first, then projects, then any extra topic matches (deduped).
  const r = build([...identity, ...projects.sections, ...ctx]);
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
