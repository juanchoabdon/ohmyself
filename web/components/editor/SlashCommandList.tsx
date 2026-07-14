"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { cn } from "@/lib/utils";

export type SlashCommandItem = {
  title: string;
  hint?: string;
  command: (props: { editor: import("@tiptap/core").Editor; range: { from: number; to: number } }) => void;
};

export const SlashCommandList = forwardRef<
  { onKeyDown: (props: { event: KeyboardEvent }) => boolean },
  { items: SlashCommandItem[]; command: (item: SlashCommandItem) => void }
>(function SlashCommandList({ items, command }, ref) {
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[index];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted shadow-lg">
        No results
      </div>
    );
  }

  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          onClick={() => command(item)}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm",
            i === index ? "bg-brand-weak text-brand-ink" : "text-ink hover:bg-bg",
          )}
        >
          <span className="font-medium">{item.title}</span>
          {item.hint ? <span className="text-xs text-muted">{item.hint}</span> : null}
        </button>
      ))}
    </div>
  );
});
