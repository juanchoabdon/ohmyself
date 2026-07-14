export type FencedField = Record<string, string>;

/** Parse `key: value` lines inside a ::: fence body. */
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

/** Split `:::marker Title` … `:::` sections inside a parent fence body. */
export function parseFencedSections(
  inner: string,
  marker: string,
  lexer: BlockLexer,
): FencedChildSection[] {
  const sections: FencedChildSection[] = [];
  const open = `:::${marker}`;
  const re = new RegExp(`^${open}\\s+([^\\n]+)\\n([\\s\\S]*?)\\n:::\\n?`, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    const title = m[1]!.trim();
    const body = m[2]!.trim();
    sections.push({
      title,
      body,
      tokens: body ? lexer.blockTokens(body) : [],
    });
  }
  return sections;
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
