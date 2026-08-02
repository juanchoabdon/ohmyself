"use client";

import { useMemo, useState } from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlockDeleteButton } from "./BlockDeleteButton";
import { deleteRichBlockAt } from "./markdownRichContent";

export function AccordionView({ selected, editor, getPos }: NodeViewProps) {
  const removeBlock = () => {
    const pos = getPos();
    if (typeof pos === "number") deleteRichBlockAt(editor, pos);
  };

  return (
    <NodeViewWrapper className={cn("oms-accordion my-4", selected && "oms-accordion--selected")}>
      <div
        className="flex justify-end border-b border-border px-2 py-1"
        contentEditable={false}
      >
        <BlockDeleteButton label="Remove accordion" onClick={removeBlock} />
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

/**
 * Each section owns whether it's expanded.
 *
 * The parent used to hold this in React context, which never reached here —
 * TipTap gives every node view its own portal, so this component is a sibling
 * of the accordion in the React tree, not a child. Nothing about an accordion
 * needs coordination between sections anyway (opening one never closed the
 * others), so local state is both correct and simpler.
 */
export function AccordionItemView({ editor, getPos, node }: NodeViewProps) {
  const index = useMemo(() => {
    const pos = getPos();
    if (typeof pos !== "number") return 0;
    return editor.state.doc.resolve(pos).index();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, getPos, node]);

  const [open, setOpen] = useState(() => index === 0);
  const title = (node.attrs.title as string) || "Section";

  return (
    <NodeViewWrapper className="oms-accordion-item border-b border-border last:border-b-0">
      {/* Chrome, not content: without contentEditable={false} ProseMirror
          treats the header as editable text and eats the click. */}
      <div contentEditable={false}>
        <button
          type="button"
          className="oms-accordion-item__trigger flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm font-medium"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span>{title}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {/* Always rendered. Unmounting NodeViewContent takes the node's contentDOM
          away from ProseMirror, which loses track of the section's children. */}
      <div className={cn("oms-accordion-item__body pb-3", !open && "hidden")}>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}
