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
