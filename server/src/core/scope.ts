import type { Scope, Visibility } from "./types.js";

const RANK: Record<Visibility, number> = { public: 0, private: 1, secret: 2 };
const ALL: Visibility[] = ["public", "private", "secret"];

export function rank(level: Scope | Visibility): number {
  return RANK[level];
}

/** Can a caller with `scope` read a note with `visibility`? */
export function canRead(scope: Scope, visibility: Visibility): boolean {
  return RANK[scope] >= RANK[visibility];
}

/** The set of visibilities a scope is allowed to read. */
export function allowedVisibilities(scope: Scope): Visibility[] {
  return ALL.filter((v) => RANK[v] <= RANK[scope]);
}

/** Public scope is read-only; private/secret can write. */
export function canWrite(scope: Scope): boolean {
  return scope !== "public";
}

/** Clamp a requested scope to a maximum (e.g. downscope a personal agent). */
export function clampScope(requested: Scope, max: Scope): Scope {
  return RANK[requested] <= RANK[max] ? requested : max;
}

export function isVisibility(v: unknown): v is Visibility {
  return v === "public" || v === "private" || v === "secret";
}

export function isScope(v: unknown): v is Scope {
  return isVisibility(v);
}
