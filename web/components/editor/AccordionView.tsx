"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type AccordionCtx = {
  open: Set<number>;
  toggle: (n: number) => void;
};

export const AccordionContext = createContext<AccordionCtx | null>(null);

export function AccordionView({ node }: NodeViewProps) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));

  const toggle = (n: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  return (
    <AccordionContext.Provider value={{ open, toggle }}>
      <NodeViewWrapper className="oms-accordion my-4">
        <NodeViewContent />
      </NodeViewWrapper>
    </AccordionContext.Provider>
  );
}

export function AccordionItemView({ editor, getPos, node }: NodeViewProps) {
  const ctx = useContext(AccordionContext);
  const index = useMemo(() => {
    const pos = getPos();
    if (typeof pos !== "number") return 0;
    return editor.state.doc.resolve(pos).index();
  }, [editor, getPos, node]);

  const title = (node.attrs.title as string) || "Section";
  const isOpen = ctx?.open.has(index) ?? index === 0;

  return (
    <NodeViewWrapper className="oms-accordion-item border-b border-border last:border-b-0">
      <button
        type="button"
        className="oms-accordion-item__trigger flex w-full items-center justify-between gap-2 py-2.5 text-left text-sm font-medium"
        onClick={() => ctx?.toggle(index)}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div className="oms-accordion-item__body pb-3">
          <NodeViewContent />
        </div>
      )}
    </NodeViewWrapper>
  );
}
