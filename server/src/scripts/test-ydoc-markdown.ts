/** Smoke test: markdown → Y doc (hydrate) → markdown (yDocToMarkdown) round-trips. */
import * as Y from "yjs";
import { applyMarkdownToYDoc } from "../collab/hydrate.js";
import { roundTripMarkdown, yDocToMarkdown } from "../collab/schema.js";

const sample = `- **Attendees:** Ana, Beto
- **Source:** [doc](https://example.com)

Resumen de la reunión con **negritas** y _cursivas_.

## Decisions & updates
- **Proyecto X:** se decidió avanzar

:::tabs
:::tab Overview
High-level summary here.

- bullet
- points
:::
:::tab Architecture
\`\`\`mermaid
flowchart LR
  Agent --> Editor
\`\`\`
:::
:::

> [!note] Un callout
> con cuerpo

## Action items
- **Me** — hacer algo _(due: 2026-07-20)_
`;

const ydoc = new Y.Doc();
applyMarkdownToYDoc(ydoc, sample);
const out = yDocToMarkdown(ydoc);
const expected = roundTripMarkdown(sample);

console.log("=== serialized from Y doc ===");
console.log(out);
console.log("=== match round-trip:", out.trim() === expected.trim(), "===");
if (out.trim() !== expected.trim()) {
  console.log("=== expected ===");
  console.log(expected);
  process.exit(1);
}
