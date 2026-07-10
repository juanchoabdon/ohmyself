import type { Brain } from "./brain.js";
import { slugify } from "./brain.js";
import type { UserConfig } from "./config.js";
import type { Visibility } from "./types.js";

/** Sub-document kinds that can live inside a project. */
export const PROJECT_KINDS = {
  prd: { folder: "prds", type: "prd", index: false },
  spec: { folder: "specs", type: "spec", index: false },
  transcript: { folder: "transcripts", type: "transcript", index: false },
  note: { folder: "notes", type: "note", index: false },
  subproject: { folder: "subprojects", type: "project", index: true },
} as const;

export type ProjectKind = keyof typeof PROJECT_KINDS;

export interface ProjectWriteResult {
  ok: true;
  path: string;
  created: boolean;
  visibility: Visibility;
  /** True when `createIfMissing:false` and the project didn't exist (no write). */
  skipped?: boolean;
}

export interface UpsertProjectInput {
  name: string;
  summary?: string;
  status?: string;
  tags?: string[];
  append?: boolean;
  visibility?: Visibility;
  /** When false, only enrich an EXISTING project; never create a new page.
   *  Used by the historical backfill (light mode). Defaults to true. */
  createIfMissing?: boolean;
}

export function projectIndexPath(name: string): string {
  return `projects/${slugify(name)}/_index.md`;
}

/** Create or update a project's overview at projects/<slug>/_index.md. */
export async function upsertProject(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  input: UpsertProjectInput,
): Promise<ProjectWriteResult> {
  const path = projectIndexPath(input.name);
  if (input.createIfMissing === false) {
    let exists = true;
    try {
      await brain.readNote(userId, path, allowed);
    } catch {
      exists = false;
    }
    if (!exists) {
      return { ok: true, path, created: false, skipped: true, visibility: allowed[0] ?? "private" };
    }
  }
  const header = input.status ? `> Status: **${input.status}**\n\n` : "";
  const { note, created } = await brain.upsertNote(
    userId,
    path,
    {
      type: "project",
      title: input.name,
      body: input.summary !== undefined ? `${header}${input.summary}` : undefined,
      append: input.append,
      tags: input.tags,
      visibility: input.visibility,
    },
    config,
    allowed,
  );
  return { ok: true, path: note.path, created, visibility: note.meta.visibility };
}

export interface AddToProjectInput {
  project: string;
  kind: ProjectKind;
  title: string;
  body?: string;
  append?: boolean;
  visibility?: Visibility;
  tags?: string[];
}

/** Add or update a document inside a project (PRD/spec/transcript/note/subproject). */
export async function addToProject(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  input: AddToProjectInput,
): Promise<ProjectWriteResult> {
  const k = PROJECT_KINDS[input.kind];
  const base = `projects/${slugify(input.project)}/${k.folder}/${slugify(input.title)}`;
  const path = k.index ? `${base}/_index.md` : `${base}.md`;
  const { note, created } = await brain.upsertNote(
    userId,
    path,
    {
      type: k.type,
      title: input.title,
      body: input.body,
      append: input.append,
      visibility: input.visibility,
      tags: input.tags,
    },
    config,
    allowed,
  );
  return { ok: true, path: note.path, created, visibility: note.meta.visibility };
}
