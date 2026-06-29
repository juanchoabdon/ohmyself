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

export interface Recall {
  text: string;
  sources: Source[];
}

interface Section {
  path: string;
  title: string;
  body: string;
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
      apiGet<{ body?: string; meta?: { title?: string } }>(`/v1/notes/${encPath(n.path)}`),
    ),
  );
  const sections: Section[] = [];
  notes.forEach((n, i) => {
    const body = (fulls[i]?.body ?? "").trim();
    if (body) sections.push({ path: n.path, title: n.title || fulls[i]?.meta?.title || n.path, body });
  });
  if (sections.length) identityCache = { at: Date.now(), data: sections };
  return sections;
}

// Public project overviews change rarely too — cache alongside identity.
const PROJECT_TTL_MS = 60_000;
const MAX_PROJECTS = 6;
const PROJECT_BODY_CHARS = 1100;
let projectCache: { at: number; data: Section[] } | null = null;

/** The owner's TOP-LEVEL public projects (projects/<slug>/_index.md). Always
 *  included so "what has he built?" works regardless of query wording/language
 *  (the brain's keyword search misses cross-language queries). */
async function projectSections(): Promise<Section[]> {
  if (projectCache && Date.now() - projectCache.at < PROJECT_TTL_MS) {
    return projectCache.data;
  }
  const list = await apiGet<{ notes?: { path: string; title: string }[] }>(
    "/v1/notes?type=project&limit=100",
  );
  // Only top-level project overviews, not nested subprojects or specs.
  const overviews = (list?.notes ?? [])
    .filter((n) => /^projects\/[^/]+\/_index\.md$/.test(n.path))
    .slice(0, MAX_PROJECTS);
  const fulls = await Promise.all(
    overviews.map((n) =>
      apiGet<{ body?: string; meta?: { title?: string } }>(`/v1/notes/${encPath(n.path)}`),
    ),
  );
  const sections: Section[] = [];
  overviews.forEach((n, i) => {
    let body = (fulls[i]?.body ?? "").trim();
    if (!body) return;
    if (body.length > PROJECT_BODY_CHARS) body = body.slice(0, PROJECT_BODY_CHARS) + "…";
    sections.push({ path: n.path, title: n.title || fulls[i]?.meta?.title || n.path, body });
  });
  if (sections.length) projectCache = { at: Date.now(), data: sections };
  return sections;
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
      notes?: { path: string; title: string; body?: string }[];
    };
    return (data.notes ?? [])
      .filter((n) => (n.body ?? "").trim())
      .map((n) => ({ path: n.path, title: n.title, body: (n.body ?? "").trim() }));
  } catch {
    return [];
  }
}

function build(sections: Section[]): Recall {
  // Dedupe by path, preserving order (identity first, then topic matches).
  const seen = new Set<string>();
  const parts: string[] = [];
  const sources: Source[] = [];
  let total = 0;
  for (const s of sections) {
    if (seen.has(s.path)) continue;
    seen.add(s.path);
    const block = `## ${s.title}\n(${s.path})\n\n${s.body}`;
    if (total + block.length > MAX_CONTEXT_CHARS) break;
    total += block.length;
    parts.push(block);
    sources.push({ path: s.path, title: s.title });
  }
  return { text: parts.join("\n\n---\n\n"), sources };
}

/**
 * Gather grounding for a question: ALWAYS include the owner's public identity
 * pages (so the agent reliably knows who they are, regardless of keyword overlap
 * or query language), plus the notes most relevant to the topic.
 */
export async function recall(topic: string, limit = 6): Promise<Recall> {
  if (!TOKEN) return { text: "", sources: [] };
  const [identity, projects, ctx] = await Promise.all([
    identitySections(),
    projectSections(),
    contextSections(topic, limit),
  ]);
  // Identity first, then projects, then any extra topic matches (deduped).
  return build([...identity, ...projects, ...ctx]);
}

/** Grounding for the opening introduction (identity is always included). */
export async function introContext(shortName: string): Promise<Recall> {
  return recall(`${shortName} bio background work projects stories sobre mí trabajo proyectos`, 8);
}

export function brainConfigured(): boolean {
  return Boolean(TOKEN);
}
