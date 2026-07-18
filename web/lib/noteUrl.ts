/** Deep link into /app for a note in a space (matches server preview_url). */
export function buildNoteShareUrl(
  path: string,
  spaceId: string,
  origin = typeof window !== "undefined" ? window.location.origin : "https://www.ohmyself.ai",
): string {
  const url = new URL("/app", origin);
  url.searchParams.set("note", path.trim().replace(/^\/+/, ""));
  if (spaceId.trim()) url.searchParams.set("space", spaceId.trim());
  return url.toString();
}

export function readNoteDeepLink(search: string): { note?: string; space?: string } {
  const params = new URLSearchParams(search);
  const note = params.get("note")?.trim().replace(/^\/+/, "");
  const space = params.get("space")?.trim();
  return {
    note: note || undefined,
    space: space || undefined,
  };
}

/** Update the browser URL without navigation (push = history entry). */
export function writeNoteDeepLink(
  path: string | null,
  spaceId: string | null,
  mode: "push" | "replace" = "replace",
): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (path) url.searchParams.set("note", path);
  else url.searchParams.delete("note");
  if (spaceId) url.searchParams.set("space", spaceId);
  else url.searchParams.delete("space");
  const href = url.pathname + url.search;
  const current = window.location.pathname + window.location.search;
  if (href === current) return;
  if (mode === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}
