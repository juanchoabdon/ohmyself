import { parseFieldLines } from "@/components/editor/fencedBlock";

/**
 * Split a note body around its media fences.
 *
 * The read-only renderer is plain `react-markdown`, which knows nothing about
 * `:::image` / `:::video` / `:::embed` — without this the blocks would show up
 * as literal text outside the visual editor. Segmenting the source is more
 * predictable than a remark plugin here, because the fence bodies are
 * `key: value` lines rather than markdown.
 */

export type MediaFence = "image" | "video" | "embed";

export type BodySegment =
  | { kind: "markdown"; text: string; key: string }
  | { kind: MediaFence; fields: Record<string, string>; key: string };

const OPEN_RE = /^:::(image|video|embed)\s*$/;
const CLOSE_RE = /^:::\s*$/;
const CODE_FENCE_RE = /^\s*(```|~~~)/;

export function splitMediaBlocks(body: string): BodySegment[] {
  const lines = body.split("\n");
  const segments: BodySegment[] = [];
  let buffer: string[] = [];
  let inCode = false;

  const flush = () => {
    const text = buffer.join("\n");
    if (text.trim()) segments.push({ kind: "markdown", text, key: `md-${segments.length}` });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // A fence inside a code block is sample text, not a media block.
    if (CODE_FENCE_RE.test(line)) inCode = !inCode;

    const open = inCode ? null : OPEN_RE.exec(line);
    if (!open) {
      buffer.push(line);
      continue;
    }

    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (CLOSE_RE.test(lines[j]!)) {
        end = j;
        break;
      }
    }
    // An unterminated fence is just text — don't swallow the rest of the note.
    if (end === -1) {
      buffer.push(line);
      continue;
    }

    flush();
    segments.push({
      kind: open[1] as MediaFence,
      fields: parseFieldLines(lines.slice(i + 1, end).join("\n")),
      key: `${open[1]}-${segments.length}`,
    });
    i = end;
  }

  flush();
  return segments;
}

/** Whether a body contains any media fence — lets callers skip the split. */
export function hasMediaBlocks(body: string): boolean {
  return /^:::(image|video|embed)\s*$/m.test(body);
}
