/** See server/src/core/dedupeBody.ts — keep in sync. */
export function dedupeRepeatedBody(body: string): { body: string; deduped: boolean } {
  const trimmed = body.replace(/\s+$/, "");
  if (trimmed.length < 200) return { body, deduped: false };

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
 * DO NOT add prefix/suffix heuristics here — a previous dedupeStackedSuffix
 * chopped legitimate notes. Only exact whole-body repetition is safe.
 */
export function repairCollabBody(body: string): { body: string; deduped: boolean } {
  return dedupeRepeatedBody(body);
}

export const dedupeExactDoubleBody = repairCollabBody;

/**
 * The header already renders the note title, so a leading `# Title` H1 in the
 * body duplicates it on screen. Hide a leading H1 that matches the title.
 * Display-layer only — see server/src/core/titleBody.ts for the write path.
 */
export function stripRedundantTitleH1(body: string, title: string): string {
  const t = title.trim();
  if (!t || !body) return body;
  const m = body.match(/^\s*#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/);
  if (!m || m[1] === undefined) return body;
  if (m[1].trim() !== t) return body;
  return body.slice(m[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
}
