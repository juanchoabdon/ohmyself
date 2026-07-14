import type { Brain } from "./brain.js";
import type { HybridHit, IndexedNote, Visibility } from "./types.js";

export type LinkSuggestion = {
  path: string;
  title: string;
  type: string;
  reason: "semantic" | "shared_backlink";
  score?: number;
};

export type GraphHint = {
  from: string;
  path: string;
  title: string;
  relation: "outgoing" | "backlink";
};

export type LinkContext = {
  note: { path: string; title: string; type: string };
  outgoing: IndexedNote[];
  backlinks: IndexedNote[];
  semantic: HybridHit[];
  suggestions: LinkSuggestion[];
  is_orphan: boolean;
  is_hub: boolean;
  backlink_count: number;
};

const HUB_BACKLINK_THRESHOLD = 5;

/** Full link graph context for a note — used by MCP link_context and web DocPanel. */
export async function getLinkContext(
  brain: Brain,
  userId: string,
  path: string,
  allowed: Visibility[],
  opts?: { semanticLimit?: number },
): Promise<LinkContext> {
  const neighbors = await brain.getNeighbors(userId, path, allowed, opts);
  const linkedSet = new Set([path, ...neighbors.outgoing.map((n) => n.path)]);

  const suggestions: LinkSuggestion[] = [];
  for (const hit of neighbors.semantic) {
    if (linkedSet.has(hit.path)) continue;
    suggestions.push({
      path: hit.path,
      title: hit.title,
      type: hit.type,
      reason: "semantic",
      score: hit.similarity ?? hit.score,
    });
    if (suggestions.length >= 8) break;
  }

  const backlink_count = neighbors.backlinks.length;
  return {
    ...neighbors,
    suggestions,
    is_orphan: neighbors.outgoing.length === 0 && backlink_count === 0,
    is_hub: backlink_count >= HUB_BACKLINK_THRESHOLD,
    backlink_count,
  };
}

/** One-hop graph expansion from top recall hits — cheap enrichment for agents. */
export async function graphHintsFromHits(
  brain: Brain,
  userId: string,
  hitPaths: string[],
  allowed: Visibility[],
  limit = 8,
): Promise<GraphHint[]> {
  const hints: GraphHint[] = [];
  const seen = new Set(hitPaths);

  for (const from of hitPaths.slice(0, 3)) {
    try {
      const nb = await brain.getNeighbors(userId, from, allowed, { semanticLimit: 0 });
      for (const n of nb.backlinks.slice(0, 2)) {
        if (seen.has(n.path)) continue;
        seen.add(n.path);
        hints.push({ from, path: n.path, title: n.title, relation: "backlink" });
        if (hints.length >= limit) return hints;
      }
      for (const n of nb.outgoing.slice(0, 2)) {
        if (seen.has(n.path)) continue;
        seen.add(n.path);
        hints.push({ from, path: n.path, title: n.title, relation: "outgoing" });
        if (hints.length >= limit) return hints;
      }
    } catch {
      /* skip inaccessible notes */
    }
  }
  return hints;
}

export function followupsFromGraph(hints: GraphHint[], topic: string): string[] {
  if (!hints.length) return [];
  const out: string[] = [];
  for (const h of hints.slice(0, 4)) {
    out.push(`Follow ${h.relation} from ${h.from}: read ${h.path} (${h.title})`);
  }
  out.push(`Use link_context on a top hit path for more suggestions around "${topic}"`);
  return out.slice(0, 5);
}
