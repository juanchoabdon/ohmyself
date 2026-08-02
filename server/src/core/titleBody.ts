/**
 * The note title lives in frontmatter (`meta.title`) and the app renders it as
 * the header. A leading `# Title` H1 in the body just duplicates it on screen,
 * so we strip a leading H1 whenever it matches the title. Frontmatter stays the
 * single source of truth for the title.
 */
function isRedundantTitleH1(h1: string, title: string): boolean {
  const h = h1.trim();
  const t = title.trim();
  if (!h || !t) return false;
  if (h === t) return true;
  const longer = h.length >= t.length ? h : t;
  const shorter = h.length >= t.length ? t : h;
  if (!longer.startsWith(shorter)) return false;
  const rest = longer.slice(shorter.length);
  // Same title with an optional subtitle: " (private beta)", " — extended"
  return /^[\s(—–-]/.test(rest);
}

export function stripRedundantTitleH1(body: string, title: string): string {
  const t = title.trim();
  if (!t || !body) return body;
  // Leading H1 (allowing blank lines before it), e.g. "\n\n# Title\n\n".
  const m = body.match(/^\s*#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/);
  if (!m || m[1] === undefined) return body;
  if (!isRedundantTitleH1(m[1], t)) return body;
  // Drop the H1 line and any blank lines that followed it.
  return body.slice(m[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
}
