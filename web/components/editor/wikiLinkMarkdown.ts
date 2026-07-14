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
