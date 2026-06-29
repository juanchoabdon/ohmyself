import {
  defaultVisibilityForType,
  folderForType,
  type UserConfig,
} from "./config.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "./errors.js";
import { excerptOf, parseNote, serializeNote, todayISO } from "./frontmatter.js";
import type { BrainIndex } from "./indexer/types.js";
import type {
  IndexedNote,
  ListOptions,
  Note,
  NoteMeta,
  SearchOptions,
  Visibility,
} from "./types.js";
import type { Vault } from "./vault/types.js";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

export interface CreateNoteInput {
  type: string;
  title: string;
  body?: string;
  visibility?: Visibility;
  tags?: string[];
  links?: string[];
  /** Explicit relative path; if omitted it is derived from type + title. */
  path?: string;
}

export interface UpdateNoteInput {
  body?: string;
  title?: string;
  visibility?: Visibility;
  tags?: string[];
  links?: string[];
}

export interface UpsertNoteInput {
  type: string;
  title?: string;
  body?: string;
  /** Append `body` to the existing note instead of replacing it. */
  append?: boolean;
  visibility?: Visibility;
  tags?: string[];
  links?: string[];
}

/** Ties a content Vault + a derived BrainIndex together and enforces
 *  per-note visibility for a given set of allowed levels. */
export class Brain {
  constructor(
    private vault: Vault,
    private index: BrainIndex,
  ) {}

  private async indexRecord(path: string, meta: NoteMeta, body: string) {
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
      content: body,
    };
  }

  async createNote(
    userId: string,
    input: CreateNoteInput,
    config: UserConfig,
    allowed?: Visibility[],
  ): Promise<Note> {
    if (!input.title?.trim()) throw new BadRequestError("title is required");
    const type = input.type?.trim() || "note";
    const visibility = input.visibility ?? defaultVisibilityForType(config, type);
    // Enforce scope even when visibility is implied by the note type (e.g. a
    // `private`-scoped connection creating a `finance` note that defaults to
    // `secret`). Without this, the type's default could exceed the caller's scope.
    if (allowed && !allowed.includes(visibility)) {
      throw new ForbiddenError(`your scope can't write ${visibility} notes`);
    }
    const path =
      input.path?.trim().replace(/^\/+/, "") ??
      `${folderForType(config, type)}/${slugify(input.title)}.md`;

    const existing = await this.vault.read(userId, path);
    if (existing) throw new BadRequestError(`note already exists at ${path}`);

    const meta: NoteMeta = {
      id: slugify(input.title),
      title: input.title.trim(),
      type,
      visibility,
      tags: input.tags ?? [],
      links: input.links ?? [],
      created: todayISO(),
      updated: todayISO(),
    };
    const body = input.body ?? "";
    await this.vault.write(userId, path, serializeNote(meta, body));
    await this.index.upsert(userId, await this.indexRecord(path, meta, body));
    return { path, meta, body };
  }

  /**
   * Create the note at `path`, or update it if it already exists. The backbone
   * of the high-level "maintain my second self" tools (update identity, upsert
   * project, save memory, …). Tags/links are merged (union) on update; `body`
   * can replace or append. Visibility is enforced against `allowed`.
   */
  async upsertNote(
    userId: string,
    path: string,
    input: UpsertNoteInput,
    config: UserConfig,
    allowed: Visibility[],
  ): Promise<{ note: Note; created: boolean }> {
    const clean = path.trim().replace(/^\/+/, "");
    const existingRaw = await this.vault.read(userId, clean);

    if (existingRaw != null) {
      const { meta, body: curBody } = parseNote(existingRaw, clean);
      if (!allowed.includes(meta.visibility)) throw new NotFoundError(`no note at ${clean}`);
      const patch: UpdateNoteInput = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.visibility !== undefined) patch.visibility = input.visibility;
      if (input.tags?.length) patch.tags = Array.from(new Set([...meta.tags, ...input.tags]));
      if (input.links?.length) patch.links = Array.from(new Set([...meta.links, ...input.links]));
      if (input.body !== undefined) {
        patch.body = input.append
          ? `${curBody.replace(/\s+$/, "")}\n\n${input.body.trim()}\n`
          : input.body;
      }
      const note = await this.updateNote(userId, clean, patch, allowed);
      return { note, created: false };
    }

    const visibility = input.visibility ?? defaultVisibilityForType(config, input.type);
    if (!allowed.includes(visibility)) {
      throw new ForbiddenError(`your scope can't write ${visibility} notes`);
    }
    const note = await this.createNote(
      userId,
      {
        type: input.type,
        title: input.title ?? clean.split("/").pop()!.replace(/\.md$/, ""),
        body: input.body ?? "",
        visibility,
        tags: input.tags,
        links: input.links,
        path: clean,
      },
      config,
      allowed,
    );
    return { note, created: true };
  }

  /** Write a note from raw markdown at an exact path, preserving its
   *  frontmatter as-is. Used for seeding and file-based imports. */
  async importRaw(userId: string, path: string, raw: string): Promise<Note> {
    const { meta, body } = parseNote(raw, path);
    await this.vault.write(userId, path, raw);
    await this.index.upsert(userId, await this.indexRecord(path, meta, body));
    return { path, meta, body };
  }

  async readNote(userId: string, path: string, allowed: Visibility[]): Promise<Note> {
    const raw = await this.vault.read(userId, path);
    if (raw == null) throw new NotFoundError(`no note at ${path}`);
    const { meta, body } = parseNote(raw, path);
    // Don't reveal existence of notes above the caller's level.
    if (!allowed.includes(meta.visibility)) throw new NotFoundError(`no note at ${path}`);
    return { path, meta, body };
  }

  async updateNote(
    userId: string,
    path: string,
    patch: UpdateNoteInput,
    allowed: Visibility[],
  ): Promise<Note> {
    const current = await this.readNote(userId, path, allowed); // enforces visibility
    const meta: NoteMeta = { ...current.meta };
    if (patch.title !== undefined) meta.title = patch.title;
    if (patch.tags !== undefined) meta.tags = patch.tags;
    if (patch.links !== undefined) meta.links = patch.links;
    if (patch.visibility !== undefined) {
      if (!allowed.includes(patch.visibility)) {
        throw new ForbiddenError("cannot set a visibility above your scope");
      }
      meta.visibility = patch.visibility;
    }
    meta.updated = todayISO();
    const body = patch.body !== undefined ? patch.body : current.body;
    await this.vault.write(userId, path, serializeNote(meta, body));
    await this.index.upsert(userId, await this.indexRecord(path, meta, body));
    return { path, meta, body };
  }

  async appendToNote(
    userId: string,
    path: string,
    text: string,
    allowed: Visibility[],
  ): Promise<Note> {
    const current = await this.readNote(userId, path, allowed);
    const body = `${current.body.replace(/\s+$/, "")}\n\n${text.trim()}\n`;
    return this.updateNote(userId, path, { body }, allowed);
  }

  async deleteNote(userId: string, path: string, allowed: Visibility[]): Promise<void> {
    await this.readNote(userId, path, allowed); // enforce visibility / existence
    await this.vault.remove(userId, path);
    await this.index.remove(userId, path);
  }

  /** Move/rename a note to a new path, preserving its frontmatter. Used by the
   *  UI to rename notes and folders (one move per file under the folder). */
  async moveNote(
    userId: string,
    from: string,
    to: string,
    allowed: Visibility[],
  ): Promise<Note> {
    const dest = to.trim().replace(/^\/+/, "");
    if (!dest) throw new BadRequestError("destination path is required");
    if (!dest.endsWith(".md")) throw new BadRequestError("destination must end in .md");
    const current = await this.readNote(userId, from, allowed); // existence + visibility
    if (dest === from) return current;
    const collision = await this.vault.read(userId, dest);
    if (collision != null) throw new BadRequestError(`a note already exists at ${dest}`);

    await this.vault.write(userId, dest, serializeNote(current.meta, current.body));
    await this.index.upsert(userId, await this.indexRecord(dest, current.meta, current.body));
    await this.vault.remove(userId, from);
    await this.index.remove(userId, from);
    return { path: dest, meta: current.meta, body: current.body };
  }

  async listNotes(userId: string, opts: ListOptions): Promise<IndexedNote[]> {
    return this.index.list(userId, opts);
  }

  async search(userId: string, query: string, opts: SearchOptions): Promise<IndexedNote[]> {
    return this.index.search(userId, query, opts);
  }

  async linkNotes(userId: string, a: string, b: string, allowed: Visibility[]): Promise<void> {
    const na = await this.readNote(userId, a, allowed);
    const nb = await this.readNote(userId, b, allowed);
    if (!na.meta.links.includes(b)) {
      await this.updateNote(userId, a, { links: [...na.meta.links, b] }, allowed);
    }
    if (!nb.meta.links.includes(a)) {
      await this.updateNote(userId, b, { links: [...nb.meta.links, a] }, allowed);
    }
  }

  /** Aggregate the most relevant notes for a topic into a single context blob
   *  an agent can reason over. Respects visibility. */
  async getContext(
    userId: string,
    topic: string,
    allowed: Visibility[],
    limit = 6,
  ): Promise<{ topic: string; notes: { path: string; title: string; body: string }[]; text: string }> {
    const hits = await this.search(userId, topic, { allowed, limit });
    const notes: { path: string; title: string; body: string }[] = [];
    for (const h of hits) {
      try {
        const n = await this.readNote(userId, h.path, allowed);
        notes.push({ path: n.path, title: n.meta.title, body: n.body });
      } catch {
        /* skip */
      }
    }
    const text = notes
      .map((n) => `## ${n.title}\n(${n.path})\n\n${n.body}`)
      .join("\n\n---\n\n");
    return { topic, notes, text };
  }
}
