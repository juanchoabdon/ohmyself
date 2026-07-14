import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "@tiptap/markdown";
import Collaboration from "@tiptap/extension-collaboration";
import type { Extensions } from "@tiptap/core";
import type * as Y from "yjs";
import { WikiLink } from "./WikiLink";
import { OmsCodeBlock } from "./OmsCodeBlock";
import { SlashCommand } from "./slashCommand";

export function buildEditorExtensions(
  onOpenLink?: (path: string) => void,
  collaborationDocument?: Y.Doc,
): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      codeBlock: false,
      // Yjs owns undo/redo when collaborating.
      undoRedo: collaborationDocument ? false : undefined,
    }),
    OmsCodeBlock,
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { class: "oms-md-link" },
    }),
    WikiLink.configure({ onOpenLink }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    SlashCommand,
    Markdown,
    ...(collaborationDocument
      ? [Collaboration.configure({ document: collaborationDocument })]
      : []),
  ];
}
