import { excerptOf, parseNote } from "../frontmatter.js";
import type {
  FolderCount,
  IndexRecord,
  IndexedNote,
  ListOptions,
  SearchOptions,
  Visibility,
} from "../types.js";
import type { Vault } from "../vault/types.js";
import type { BrainIndex } from "./types.js";

/** In-memory index that scans the FS vault on each query. Fine for local,
 *  single-user use. The `upsert`/`remove` no-ops because the FS is the source
 *  of truth and we re-scan lazily. */
export class FsIndex implements BrainIndex {
  constructor(private vault: Vault) {}

  async upsert(): Promise<void> {
    /* no-op: scanned lazily from disk */
  }
  async remove(): Promise<void> {
    /* no-op */
  }

  private async scan(userId: string): Promise<IndexedNote[]> {
    const paths = await this.vault.listPaths(userId);
    const notes: IndexedNote[] = [];
    for (const p of paths) {
      const raw = await this.vault.read(userId, p);
      if (raw == null) continue;
      const { meta, body } = parseNote(raw, p);
      notes.push({
        path: p,
        id: meta.id,
        title: meta.title,
        type: meta.type,
        visibility: meta.visibility,
        tags: meta.tags,
        links: meta.links,
        created: meta.created,
        updated: meta.updated,
        excerpt: excerptOf(body),
      });
    }
    return notes;
  }

  async get(userId: string, path: string): Promise<IndexedNote | null> {
    const raw = await this.vault.read(userId, path);
    if (raw == null) return null;
    const { meta, body } = parseNote(raw, path);
    return {
      path,
      id: meta.id,
      title: meta.title,
      type: meta.type,
      visibility: meta.visibility,
      tags: meta.tags,
      links: meta.links,
      created: meta.created,
      updated: meta.updated,
      excerpt: excerptOf(body),
    };
  }

  private filter(notes: IndexedNote[], opts: ListOptions): IndexedNote[] {
    return notes.filter((n) => {
      if (!opts.allowed.includes(n.visibility)) return false;
      if (opts.types?.length && !opts.types.includes(n.type)) return false;
      if (opts.tags?.length && !opts.tags.some((t) => n.tags.includes(t))) return false;
      return true;
    });
  }

  async list(userId: string, opts: ListOptions): Promise<IndexedNote[]> {
    let all = this.filter(await this.scan(userId), opts);
    if (opts.prefix) all = all.filter((n) => n.path.startsWith(opts.prefix!));
    all.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
    return all.slice(0, opts.limit ?? 200);
  }

  async folderCounts(userId: string, allowed: Visibility[]): Promise<FolderCount[]> {
    const notes = this.filter(await this.scan(userId), { allowed });
    const counts = new Map<string, number>();
    for (const n of notes) {
      const top = n.path.split("/")[0] || "(root)";
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts.entries()].map(([folder, count]) => ({ folder, count }));
  }

  async search(userId: string, query: string, opts: SearchOptions): Promise<IndexedNote[]> {
    const trimmed = query.trim().toLowerCase();
    const candidates = this.filter(await this.scan(userId), opts);
    if (!trimmed) return candidates.slice(0, opts.limit ?? 50);
    const terms = trimmed.split(/\s+/);
    const scored = candidates
      .map((n) => {
        const hay = `${n.title} ${n.tags.join(" ")} ${n.excerpt ?? ""}`.toLowerCase();
        const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
        return { n, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.limit ?? 50).map((x) => x.n);
  }
}

/** Re-export to satisfy callers that index on write (no-op for FS). */
export type { IndexRecord };
