import type { AuthContext } from "./types.js";
import { findById, nameOf } from "./users.js";
import type { WriteAttribution } from "./versions/types.js";

/** Compact one-line label safe to store as a version author. */
export function cleanAgentLabel(label?: string | null): string | null {
  const clean = label?.replace(/\s+/g, " ").trim().slice(0, 80);
  return clean || null;
}

/** Build version-history author metadata from the resolved request identity.
 *  Agents are attributed by WHO they are (token name / OAuth client / MCP
 *  client), falling back to HOW they authenticated ("agent:token").
 *
 *  `authorLabel` is the pass-through lane (bonds ai-in-chat B2ext): a machine
 *  caller writing ON BEHALF of a person who is not an ohmyself user (a room
 *  member) names them explicitly — "sofi · via bonds" — and that label wins
 *  over the token's own name. Never trusted as an identity, only as history. */
export function attributionFromAuth(
  auth: AuthContext,
  summary?: string,
  authorLabel?: string | null,
): WriteAttribution {
  const passThrough = cleanAgentLabel(authorLabel);
  if (passThrough) return { author: `agent:${passThrough}`, summary };
  const via = auth.via ?? "token";
  if (via === "jwt") return { author: "human", summary };
  const label = cleanAgentLabel(auth.clientLabel);
  return { author: `agent:${label ?? via}`, summary };
}

/// Nombre de una cuenta, cacheado: una escritura no puede pagar un viaje a
/// la base por saber cómo se llama quien la hizo.
const personCache = new Map<string, { name: string | null; at: number }>();
const PERSON_TTL_MS = 10 * 60_000;

/** Quién está escribiendo, por su nombre. null si la cuenta no resuelve. */
export async function personOf(userId: string, now = Date.now()): Promise<string | null> {
  const hit = personCache.get(userId);
  if (hit && now - hit.at < PERSON_TTL_MS) return hit.name;
  let name: string | null = null;
  try {
    const profile = await findById(userId);
    name = profile ? nameOf(profile) : null;
  } catch {
    name = null;
  }
  personCache.set(userId, { name, at: now });
  return name;
}

/** Solo tests. */
export function resetPersonCache(): void {
  personCache.clear();
}

/**
 * La atribución completa: el CLIENTE (`author`) y la PERSONA (`person`).
 *
 * Esta es la que usan los caminos de escritura, porque la persona es lo que
 * hace contestable "¿qué subió Sebas?" en un brain compartido. Sale de la
 * cuenta autenticada, así que un write por MCP desde Claude, uno desde la
 * web y uno por la API quedan todos firmados igual, sin que el cliente
 * tenga que acordarse de mandar nada.
 *
 * `personOverride` es el carril de quien escribe POR alguien: bonds guarda
 * una nota que pidió un miembro del room que no tiene cuenta de ohmyself, y
 * ese nombre manda sobre el de la cuenta de servicio.
 */
export async function attributionWithPerson(
  auth: AuthContext,
  summary?: string,
  authorLabel?: string | null,
  personOverride?: string | null,
): Promise<WriteAttribution> {
  const base = attributionFromAuth(auth, summary, authorLabel);
  const explicit = cleanAgentLabel(personOverride);
  const person = explicit ?? (await personOf(auth.userId));
  return person ? { ...base, person } : base;
}
