/** Notes are files (e.g. `specs/00-index.md`) but their `title` field is a
 *  human-friendly heading with no extension — which reads ambiguously in a
 *  file-browser-style UI ("00 Index" looks like a made-up label, not a real
 *  file). Append the real extension from the note's `path` so every list,
 *  card, header, and graph label makes clear these are actual files. */
export function displayTitle(title: string, path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  if (dot <= slash || dot === path.length - 1) return title;
  const ext = path.slice(dot);
  return title.toLowerCase().endsWith(ext.toLowerCase()) ? title : `${title}${ext}`;
}

/** "juandisanchez-com" -> "Juandisanchez Com". Only a fallback label for a
 *  project folder that has no public overview note of its own to name it
 *  (see `projectFolderLabel` in app/brain/page.tsx). */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
