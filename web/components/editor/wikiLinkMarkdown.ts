/** Convert `[[path]]` / `[[path|label]]` to markdown links the read view understands. */
export function wikiLinksToMarkdownLinks(body: string): string {
  return body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, path: string, label?: string) => {
    const p = path.trim();
    const l = (label?.trim() || p).replace(/\\/g, "\\\\").replace(/\[/g, "\\[");
    const safePath = p.replace(/\)/g, "%29");
    return `[${l}](wiki:${safePath})`;
  });
}

export function isWikiHref(href?: string): boolean {
  return typeof href === "string" && href.startsWith("wiki:");
}

export function wikiPathFromHref(href: string): string {
  return decodeURIComponent(href.slice("wiki:".length));
}

/** True for wiki links and relative note paths (not http/mailto/hash). */
export function isInternalNoteHref(href?: string): boolean {
  if (!href) return false;
  if (isWikiHref(href)) return true;
  if (/^(https?:|mailto:|tel:|#)/i.test(href)) return false;
  return true;
}

export function notePathFromHref(href: string): string {
  if (isWikiHref(href)) return wikiPathFromHref(href);
  try {
    return decodeURIComponent(href.replace(/^\//, ""));
  } catch {
    return href.replace(/^\//, "");
  }
}
