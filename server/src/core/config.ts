import { z } from "zod";
import type { Visibility } from "./types.js";

export const VisibilitySchema = z.enum(["public", "private", "secret"]);

export const NoteTypeSchema = z.object({
  id: z.string(),
  label: z.string(),
  folder: z.string(),
  defaultVisibility: VisibilitySchema.default("private"),
});

export const UserConfigSchema = z.object({
  version: z.number().default(1),
  visibilityLevels: z.array(VisibilitySchema).default(["public", "private", "secret"]),
  defaultVisibility: VisibilitySchema.default("private"),
  noteTypes: z.array(NoteTypeSchema).min(1),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;
export type NoteType = z.infer<typeof NoteTypeSchema>;

/** Canonical default taxonomy. Mirrors templates/default-config.json. */
export const DEFAULT_CONFIG: UserConfig = {
  version: 1,
  visibilityLevels: ["public", "private", "secret"],
  defaultVisibility: "private",
  noteTypes: [
    { id: "identity", label: "Identity", folder: "identity", defaultVisibility: "private" },
    { id: "goal", label: "Goal", folder: "goals", defaultVisibility: "private" },
    { id: "project", label: "Project", folder: "projects", defaultVisibility: "private" },
    { id: "prd", label: "PRD", folder: "projects", defaultVisibility: "private" },
    { id: "spec", label: "Spec", folder: "projects", defaultVisibility: "private" },
    { id: "transcript", label: "Transcript", folder: "projects", defaultVisibility: "private" },
    { id: "person", label: "Person", folder: "people", defaultVisibility: "private" },
    { id: "journal", label: "Journal", folder: "journal", defaultVisibility: "private" },
    { id: "finance", label: "Finance", folder: "finance", defaultVisibility: "secret" },
    { id: "note", label: "Note", folder: "notes", defaultVisibility: "private" },
    { id: "todo", label: "Todo", folder: "todos", defaultVisibility: "private" },
    { id: "meeting", label: "Meeting", folder: "meetings", defaultVisibility: "private" },
    { id: "concept", label: "Concept", folder: "concepts", defaultVisibility: "private" },
    { id: "commitment", label: "Commitment", folder: "commitments", defaultVisibility: "private" },
    { id: "skill", label: "Skill", folder: "skills", defaultVisibility: "private" },
  ],
};

/** Default taxonomy for a **company** space — an AI-native startup wiki from
 *  scratch. Mirrors templates/company-default-config.json. In a company space
 *  the visibility ladder reads as company-wide (`public`) / internal (`private`)
 *  / founders-only (`secret`); the labels are surfaced in the UI. */
export const DEFAULT_COMPANY_CONFIG: UserConfig = {
  version: 1,
  visibilityLevels: ["public", "private", "secret"],
  defaultVisibility: "private",
  noteTypes: [
    { id: "company", label: "Company", folder: "company", defaultVisibility: "private" },
    { id: "thesis", label: "Thesis", folder: "thesis", defaultVisibility: "private" },
    { id: "product", label: "Product", folder: "product", defaultVisibility: "private" },
    { id: "prd", label: "PRD", folder: "product", defaultVisibility: "private" },
    { id: "spec", label: "Spec", folder: "product", defaultVisibility: "private" },
    { id: "market", label: "Market", folder: "market", defaultVisibility: "private" },
    { id: "research", label: "Research", folder: "research", defaultVisibility: "private" },
    { id: "person", label: "Person", folder: "people", defaultVisibility: "private" },
    { id: "gtm", label: "Go-to-market", folder: "gtm", defaultVisibility: "private" },
    { id: "ops", label: "Ops", folder: "ops", defaultVisibility: "private" },
    { id: "finance", label: "Finance", folder: "finance", defaultVisibility: "secret" },
    { id: "decision", label: "Decision", folder: "decisions", defaultVisibility: "private" },
    { id: "meeting", label: "Meeting", folder: "meetings", defaultVisibility: "private" },
    { id: "goal", label: "Goal", folder: "goals", defaultVisibility: "private" },
    { id: "note", label: "Note", folder: "notes", defaultVisibility: "private" },
    { id: "skill", label: "Skill", folder: "skills", defaultVisibility: "private" },
  ],
};

/** Parse/validate an arbitrary config object, falling back to defaults. */
export function loadConfig(raw: unknown): UserConfig {
  if (raw == null || (typeof raw === "object" && Object.keys(raw).length === 0)) {
    return DEFAULT_CONFIG;
  }
  const parsed = UserConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_CONFIG;
}

export function findType(config: UserConfig, typeId: string): NoteType | undefined {
  return config.noteTypes.find((t) => t.id === typeId);
}

export function folderForType(config: UserConfig, typeId: string): string {
  return findType(config, typeId)?.folder ?? "notes";
}

export function defaultVisibilityForType(config: UserConfig, typeId: string): Visibility {
  return findType(config, typeId)?.defaultVisibility ?? config.defaultVisibility;
}

/** Folders the PERSONAL taxonomy owns. Each one carries personal-brain
 *  semantics — `projects/<slug>/_index.md`, `journal/`, `identity/` — so it only
 *  means anything in a space that declares it. A company wiki keeps the same
 *  content under the folders its own taxonomy names (product/, thesis/,
 *  decisions/), which is why writing `projects/` there is always a mistake. */
const PERSONAL_PILLARS = [
  ...DEFAULT_CONFIG.noteTypes.map((t) => t.folder),
  // Not a declared type — `remember` writes straight to memory/log.md — but it is
  // the most personal folder there is: a log of what the owner said in passing.
  "memory",
];

/**
 * The top-level folder `path` lands in, when that folder is a personal-brain
 * pillar this space does NOT declare. Returns null when the write is fine.
 *
 * This is the chokepoint that keeps personal conventions out of company wikis:
 * several writers (upsert_project, the write_brain classifier, an explicit
 * `path` argument) were built for a personal brain and name `projects/`
 * unconditionally. Folders outside any taxonomy (a wiki's own `engineering/`)
 * stay free-form; only a pillar borrowed from a different taxonomy is refused.
 */
/**
 * Is this space somebody's personal brain, as opposed to a company wiki?
 *
 * Read off the taxonomy rather than the space record, so it stays true for a
 * space that customizes its folders. The two shapes route very differently: a
 * brain has a memory log, a journal, an identity page and `projects/`; a company
 * wiki has none of those and files everything under its own document types
 * (thesis, product, decision, gtm).
 */
export function isPersonalBrain(config: UserConfig): boolean {
  return config.noteTypes.some((t) => t.folder === "identity");
}

export function undeclaredPillar(config: UserConfig, path: string): string | null {
  const top = path.trim().replace(/^\/+/, "").split("/")[0] ?? "";
  if (!PERSONAL_PILLARS.includes(top)) return null;
  return config.noteTypes.some((t) => t.folder === top) ? null : top;
}

/** Every type either canonical taxonomy defines. A type outside this set is a
 *  space's own invention and stays free-form; one inside it has fixed meaning,
 *  so using it where the space doesn't declare it is a mistake. */
const CANONICAL_TYPES = new Set(
  [...DEFAULT_CONFIG.noteTypes, ...DEFAULT_COMPANY_CONFIG.noteTypes].map((t) => t.id),
);

/**
 * A note type that means something in this product but nothing in THIS space —
 * `project` in a company wiki, `thesis` in a personal brain. Returns null when
 * the type is fine (declared here, or a free-form one).
 *
 * The folder guard alone isn't enough: `folderForType` silently falls back to
 * `notes/`, so an undeclared type would file a note in a real folder while
 * carrying a type the space's UI has no group for.
 */
export function undeclaredType(config: UserConfig, typeId: string | undefined): string | null {
  const id = typeId?.trim();
  if (!id || findType(config, id)) return null;
  return CANONICAL_TYPES.has(id) ? id : null;
}
