/**
 * TipTap schema aligned with the web editor (minus WikiLink / custom code block).
 * Used to parse agent markdown into Yjs XmlFragment for live collab.
 */
import { Node } from "@tiptap/pm/model";
import { getSchema } from "@tiptap/core";
import type { Extensions, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { richMarkdownExtensions } from "./richMarkdownExtensions.js";

const COLLAB_FIELD = "default";

const extensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: false,
    codeBlock: false,
    undoRedo: false,
  }),
  ...richMarkdownExtensions,
  Link.configure({ openOnClick: false, autolink: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown,
];

const schema = getSchema(extensions);
const markdown = new MarkdownManager({ extensions });

export function collabFieldName(): string {
  return COLLAB_FIELD;
}

export function markdownToProsemirrorJson(body: string): JSONContent {
  const trimmed = body.trim();
  if (!trimmed) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return markdown.parse(body);
}

export function jsonToProsemirrorNode(json: JSONContent) {
  return Node.fromJSON(schema, json);
}
