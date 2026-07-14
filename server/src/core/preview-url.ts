/** Deep link into the ohmyself web app for live preview after agent writes. */
export function buildPreviewUrl(path: string, spaceId: string): string {
  const web = (process.env.PUBLIC_WEB_URL || "https://www.ohmyself.ai").replace(/\/+$/, "");
  const url = new URL(`${web}/app`);
  url.searchParams.set("note", path.trim());
  if (spaceId.trim()) url.searchParams.set("space", spaceId.trim());
  return url.toString();
}
