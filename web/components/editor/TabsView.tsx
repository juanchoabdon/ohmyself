"use client";

import { useMemo, useSyncExternalStore } from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { BlockDeleteButton } from "./BlockDeleteButton";
import { deleteRichBlockAt } from "./markdownRichContent";
import { activeTab, setActiveTab, subscribeTabs } from "./tabsState";

/** The tabs block's own position, shared by the header and its panels. */
function useTabsKey(key: string): number {
  return useSyncExternalStore(
    subscribeTabs,
    () => activeTab(key),
    () => 0,
  );
}

export function TabsView({ node, selected, editor, getPos }: NodeViewProps) {
  const pos = getPos();
  const key = String(typeof pos === "number" ? pos : -1);
  const active = useTabsKey(key);

  const titles = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      list.push((node.child(i).attrs.title as string) || `Tab ${i + 1}`);
    }
    return list;
  }, [node]);

  const removeBlock = () => {
    if (typeof pos === "number") deleteRichBlockAt(editor, pos);
  };

  return (
    <NodeViewWrapper className={cn("oms-tabs my-4", selected && "oms-tabs--selected")}>
      {/* Chrome, not content: without contentEditable={false} ProseMirror
          treats these buttons as editable text and eats the click. */}
      <div className="oms-tabs__header" role="tablist" contentEditable={false}>
        {titles.map((title, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={active === i}
            className={cn("oms-tabs__tab", active === i && "oms-tabs__tab--active")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActiveTab(key, i)}
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
  );
}

export function TabView({ editor, getPos, node }: NodeViewProps) {
  const { index, parentKey } = useMemo(() => {
    const pos = getPos();
    if (typeof pos !== "number") return { index: 0, parentKey: "-1" };
    const $pos = editor.state.doc.resolve(pos);
    // `before(depth)` is the position right before the tabs node — exactly what
    // the parent gets from its own getPos(), so both derive the same key.
    return { index: $pos.index(), parentKey: String($pos.before($pos.depth)) };
  }, [editor, getPos, node]);

  const active = useTabsKey(parentKey);

  return (
    <NodeViewWrapper
      className={cn("oms-tab-panel", index !== active && "oms-tab-panel--hidden")}
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
