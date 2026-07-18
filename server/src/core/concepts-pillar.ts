/**
 * Keep the personal-brain `concepts/` glossary pillar healthy: taxonomy row +
 * index stub. Company spaces use a different taxonomy and skip this.
 */

import type { Brain } from "./brain.js";
import type { UserConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import { getSpaceConfig, setSpaceConfig } from "./config-store.js";
import { getSpace } from "./spaces.js";
import type { Visibility } from "./types.js";

const CONCEPT_TYPE = DEFAULT_CONFIG.noteTypes.find((t) => t.id === "concept")!;

export const CONCEPTS_INDEX_PATH = "concepts/_index.md";

export const CONCEPTS_INDEX_BODY = `Glosario personal de términos reutilizables — vocabulario que vuelves a encontrar en muchos contextos.

## Regla
Un **concepto** es un headword durable (sistema, métrica, técnica, acrónimo). No es un proyecto con roadmap, una persona, ni un procedimiento.

| Si… | Va en… |
|---|---|
| Roadmap / entregables | \`projects/\` |
| Persona | \`people/\` |
| Procedimiento | \`skills/\` |
| Término reutilizable | \`concepts/\` |

Los conceptos se enriquecen desde meetings vía ingest y \`profileStaleConcepts\` (scheduler ~3h). Páginas con tag \`glossary-seed\` están curadas a mano y el wiki-lint no las demueve.
`;

/** Ensure the Concept note-type exists in a self space config. Returns updated config. */
export function mergeConceptCategory(config: UserConfig): { config: UserConfig; changed: boolean } {
  if (config.noteTypes.some((t) => t.id === "concept")) {
    return { config, changed: false };
  }
  return {
    config: { ...config, noteTypes: [...config.noteTypes, CONCEPT_TYPE] },
    changed: true,
  };
}

/** Idempotent: concept category + \`concepts/_index.md\` for a self space. */
export async function ensureConceptPillar(
  brain: Brain,
  spaceId: string,
  allowed: Visibility[],
): Promise<{ configPatched: boolean; indexCreated: boolean }> {
  const space = await getSpace(spaceId);
  if (!space || space.kind !== "self") return { configPatched: false, indexCreated: false };

  let config = await getSpaceConfig(spaceId);
  const merged = mergeConceptCategory(config);
  config = merged.config;
  let configPatched = false;
  if (merged.changed) {
    await setSpaceConfig(spaceId, config);
    configPatched = true;
  }

  const existing = await brain.readNote(spaceId, CONCEPTS_INDEX_PATH, allowed).catch(() => null);
  if (existing) return { configPatched, indexCreated: false };

  await brain.upsertNote(
    spaceId,
    CONCEPTS_INDEX_PATH,
    {
      type: "concept",
      title: "Concepts",
      body: CONCEPTS_INDEX_BODY,
      tags: ["concept", "glossary", "index"],
      visibility: "private",
    },
    config,
    allowed,
  );
  return { configPatched, indexCreated: true };
}
