export type OutlineItem = { level: number; text: string };
export function cleanHeadingText(raw: string): string {
  return raw
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\#/g, "#")
    .trim();
}

export function extractOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const line of markdown.split("\n")) {
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) items.push({ level: m[1]!.length, text: cleanHeadingText(m[2]!) });
  }
  return items;
}

