"use client";

import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { AlertCircle, AlertTriangle, Info, Lightbulb, StickyNote } from "lucide-react";
import type { CalloutType } from "./Callout";
import { cn } from "@/lib/utils";
import { BlockDeleteButton } from "./BlockDeleteButton";
import { deleteRichBlockAt } from "./markdownRichContent";

const CALLOUT_TYPES: CalloutType[] = ["info", "note", "tip", "warning", "error"];

const CALLOUT_META: Record<
  CalloutType,
  { label: string; icon: typeof Info; className: string }
> = {
  info: { label: "Info", icon: Info, className: "oms-callout--info" },
  note: { label: "Note", icon: StickyNote, className: "oms-callout--note" },
  tip: { label: "Tip", icon: Lightbulb, className: "oms-callout--tip" },
  warning: { label: "Warning", icon: AlertTriangle, className: "oms-callout--warning" },
  error: { label: "Error", icon: AlertCircle, className: "oms-callout--error" },
};

function resolveType(raw: string): CalloutType {
  const key = raw.toLowerCase() as CalloutType;
  return key in CALLOUT_META ? key : "info";
}

export function CalloutView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const type = resolveType((node.attrs.type as string) || "info");
  const title = (node.attrs.title as string) || "";
  const meta = CALLOUT_META[type];
  const Icon = meta.icon;

  const removeBlock = () => {
    const pos = getPos();
    if (typeof pos === "number") deleteRichBlockAt(editor, pos);
  };

  return (
    <NodeViewWrapper
      className={cn("oms-callout my-3", meta.className, selected && "oms-callout--selected")}
      data-callout-type={type}
    >
      <div className="oms-callout__icon" aria-hidden>
        <Icon className="h-4 w-4" />
      </div>
      <div className="oms-callout__content">
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {selected ? (
              <div className="oms-callout__props flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                  {CALLOUT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize",
                        t === type
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-border text-muted hover:text-ink",
                      )}
                      onClick={() => updateAttributes({ type: t })}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <input
                  className="min-w-[8rem] flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm"
                  value={title}
                  placeholder="Title"
                  onChange={(e) => updateAttributes({ title: e.target.value })}
                />
              </div>
            ) : (
              <div className="oms-callout__title">{title || meta.label}</div>
            )}
          </div>
          <BlockDeleteButton label="Remove callout" onClick={removeBlock} className="shrink-0" />
        </div>
        <NodeViewContent className="oms-callout__body" />
      </div>
    </NodeViewWrapper>
  );
}
