"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { BlockDeleteButton } from "./BlockDeleteButton";
import { deleteRichBlockAt } from "./markdownRichContent";

type TabsCtx = { active: number; setActive: (n: number) => void };

export const TabsActiveContext = createContext<TabsCtx | null>(null);

export function TabsView({ node, selected, editor, getPos }: NodeViewProps) {
  const [active, setActive] = useState(0);
  const titles = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      list.push((node.child(i).attrs.title as string) || `Tab ${i + 1}`);
    }
    return list;
  }, [node]);

  const removeBlock = () => {
    const pos = getPos();
    if (typeof pos === "number") deleteRichBlockAt(editor, pos);
  };

  return (
    <TabsActiveContext.Provider value={{ active, setActive }}>
      <NodeViewWrapper className={cn("oms-tabs my-4", selected && "oms-tabs--selected")}>
        <div className="oms-tabs__header" role="tablist">
          {titles.map((title, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active === i}
              className={cn(
                "oms-tabs__tab",
                active === i && "oms-tabs__tab--active",
              )}
              onClick={() => setActive(i)}
            >
              {title}
            </button>
          ))}
          <div className="ml-auto flex items-center pr-1">
            <BlockDeleteButton label="Remove tabs" onClick={removeBlock} />
          </div>
        </div>
        <div className="oms-tabs__body">
          <NodeViewContent />
        </div>
      </NodeViewWrapper>
    </TabsActiveContext.Provider>
  );
}

export function TabView({ editor, getPos, node }: NodeViewProps) {
  const ctx = useContext(TabsActiveContext);
  const index = useMemo(() => {
    const pos = getPos();
    if (typeof pos !== "number") return 0;
    return editor.state.doc.resolve(pos).index();
  }, [editor, getPos, node]);

  const active = ctx?.active ?? 0;
  const hidden = index !== active;

  return (
    <NodeViewWrapper
      className={cn("oms-tab-panel", hidden && "oms-tab-panel--hidden")}
      data-tab-title={(node.attrs.title as string) || ""}
    >
      <NodeViewContent className="oms-tab-panel__content" />
    </NodeViewWrapper>
  );
}

export function TabTitleEditor({
  title,
  onChange,
}: {
  title: string;
  onChange: (t: string) => void;
}) {
  return (
    <input
      className="oms-tab-title-input"
      value={title}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Tab title"
    />
  );
}

export function TabsActiveProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: TabsCtx;
}) {
  return <TabsActiveContext.Provider value={value}>{children}</TabsActiveContext.Provider>;
}
