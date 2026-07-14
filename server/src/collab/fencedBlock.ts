export type FencedField = Record<string, string>;

export function parseFieldLines(body: string): FencedField {
  const fields: FencedField = {};
  for (const line of body.split("\n")) {
    const m = /^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (m) fields[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  return fields;
}

export function renderFieldLines(fields: FencedField, order: string[]): string {
  return order
    .map((key) => {
      const val = fields[key];
      return val ? `${key}: ${val}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

export interface FencedChildSection {
  title: string;
  body: string;
  tokens: unknown[];
}

type BlockLexer = { blockTokens: (src: string) => unknown[] };

export function findStandaloneFenceLine(body: string): number {
  let at = 0;
  while (at < body.length) {
    const nl = body.indexOf("\n", at);
    const line = nl === -1 ? body.slice(at) : body.slice(at, nl);
    if (/^:::\s*$/.test(line)) return at;
    if (nl === -1) break;
    at = nl + 1;
  }
  return -1;
}

export function parseNestedFencedContainer(
  src: string,
  container: string,
  child: string,
  lexer: BlockLexer,
): { raw: string; sections: FencedChildSection[] } | undefined {
  const open = `:::${container}\n`;
  if (!src.startsWith(open)) return undefined;

  let rest = src.slice(open.length);
  const sections: FencedChildSection[] = [];
  const childPrefix = `:::${child} `;

  while (rest.startsWith(childPrefix)) {
    const titleEnd = rest.indexOf("\n");
    if (titleEnd === -1) return undefined;
    const title = rest.slice(childPrefix.length, titleEnd).trim();
    rest = rest.slice(titleEnd + 1);

    const closeAt = findStandaloneFenceLine(rest);
    if (closeAt === -1) return undefined;
    const body = rest.slice(0, closeAt).replace(/\n$/, "");
    rest = rest.slice(closeAt).replace(/^:::\s*\n?/, "");

    sections.push({
      title,
      body,
      tokens: body.trim() ? lexer.blockTokens(body) : [],
    });
  }

  if (sections.length === 0) return undefined;
  const tail = rest.match(/^:::\s*\n?/);
  if (!tail) return undefined;

  const raw = src.slice(0, src.length - rest.length + tail[0]!.length);
  return { raw, sections };
}

export function renderFencedSections(
  marker: string,
  sections: Array<{ title: string; body: string }>,
): string {
  const inner = sections
    .map((s) => `:::${marker} ${s.title}\n${s.body}\n:::`)
    .join("\n");
  return `${inner}\n`;
}
