/**
 * Collab/editor artifact: the same markdown block saved N times back-to-back
 * (Yjs re-merge after a server restart can stack 2, 3, … copies).
 */
export function dedupeRepeatedBody(body: string): { body: string; deduped: boolean } {
  const trimmed = body.replace(/\s+$/, "");
  if (trimmed.length < 200) return { body, deduped: false };

  // Where does the opening of the note repeat? Those are candidate seams.
  const probe = trimmed.slice(0, 120);
  const seams: number[] = [];
  let at = trimmed.indexOf(probe, 1);
  while (at !== -1) {
    seams.push(at);
    at = trimmed.indexOf(probe, at + probe.length);
  }
  if (seams.length === 0) return { body, deduped: false };

  const first = trimmed.slice(0, seams[0]!).trim();
  if (first.length < 80) return { body, deduped: false };

  const bounds = [0, ...seams, trimmed.length];
  for (let i = 0; i + 1 < bounds.length; i++) {
    if (trimmed.slice(bounds[i]!, bounds[i + 1]!).trim() !== first) {
      return { body, deduped: false };
    }
  }
  return { body: first.endsWith("\n") ? first : `${first}\n`, deduped: true };
}

/**
 * DO NOT add prefix/suffix "stacked content" heuristics here. A previous
 * attempt (dedupeStackedSuffix) chopped legitimate notes whose first H2
 * section was short — catastrophic data loss. Only exact whole-body
 * repetition is safe to auto-repair.
 */
export function repairCollabBody(body: string): { body: string; deduped: boolean } {
  return dedupeRepeatedBody(body);
}

/** @deprecated kept for callers that still import the 2x-only variant. */
export function dedupeExactDoubleBody(body: string): { body: string; deduped: boolean } {
  return dedupeRepeatedBody(body);
}
