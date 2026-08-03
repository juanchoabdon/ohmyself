/** Convert `[[path]]` / `[[path|label]]` to markdown links the read view understands. */
export function wikiLinksToMarkdownLinks(body: string): string {
  return body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, path: string, label?: string) => {
    const p = path.trim();
    const l = (label?.trim() || p).replace(/\\/g, "\\\\").replace(/\[/g, "\\[");
    const safePath = p.replace(/\)/g, "%29");
    return `[${l}](wiki:${safePath})`;
  });
}

/** `[label](path)` with internal href → `wiki:` so linkify cannot steal `.md` link text. */
export function internalMarkdownLinksToWikiLinks(body: string): string {
  return body.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (match, label: string, href: string) => {
    const path = href.trim().split(/\s+/)[0]!.replace(/^<|>$/g, "");
    if (isWikiHref(path)) return match;
    if (/^(https?:|mailto:|tel:|#)/i.test(path)) return match;
    const safePath = path.replace(/\)/g, "%29");
    const title = href.trim().slice(path.length).trim();
    const suffix = title ? ` ${title}` : "";
    return `[${label}](wiki:${safePath}${suffix})`;
  });
}

/** Prepare vault markdown for rendering / TipTap parse (explicit hrefs win). */
export function prepareNoteLinks(body: string): string {
  return internalMarkdownLinksToWikiLinks(wikiLinksToMarkdownLinks(body));
}

/** Round-trip `wiki:` link hrefs back to plain paths for vault storage. */
export function normalizeNoteLinksForStorage(body: string): string {
  return body.replace(/\]\(wiki:([^)\s]+)([^)]*)\)/g, (_, path: string, rest: string) => {
    try {
      return `](${decodeURIComponent(path)}${rest})`;
    } catch {
      return `](${path}${rest})`;
    }
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

/** TipTap Link default shouldAutoLink (mirrors @tiptap/extension-link). */
function defaultShouldAutoLinkUrl(url: string): boolean {
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
  const hasMaybeProtocol = /^[a-z][a-z0-9+.-]*:/i.test(url);

  if (hasProtocol || (hasMaybeProtocol && !url.includes("@"))) {
    return true;
  }
  const urlWithoutUserinfo = url.includes("@") ? url.split("@").pop()! : url;
  const hostname = urlWithoutUserinfo.split(/[/?#:]/)[0]!;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }
  if (!/\./.test(hostname)) {
    return false;
  }
  return true;
}

/**
 * Linkify treats `note.md` as a Moldova TLD URL. Block autolink for note
 * filenames and slash paths so `[label](href)` keeps the explicit href.
 */
export function shouldAutoLinkNoteUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/\.md(?:[?#].*)?$/i.test(value)) return false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && value.includes("/")) return false;
  return defaultShouldAutoLinkUrl(value);
}
