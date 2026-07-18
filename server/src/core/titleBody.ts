/**
 * The note title lives in frontmatter (`meta.title`) and the app renders it as
 * the header. A leading `# Title` H1 in the body just duplicates it on screen,
 * so we strip a leading H1 whenever it matches the title. Frontmatter stays the
 * single source of truth for the title.
 */
export function stripRedundantTitleH1(body: string, title: string): string {
  const t = title.trim();
  if (!t || !body) return body;
  // Leading H1 (allowing blank lines before it), e.g. "\n\n# Title\n\n".
  const m = body.match(/^\s*#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/);
  if (!m || m[1] === undefined) return body;
  if (m[1].trim() !== t) return body;
  // Drop the H1 line and any blank lines that followed it.
  return body.slice(m[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
}
