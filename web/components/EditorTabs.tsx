"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import type { EditorTab } from "@/lib/editorTabs";
import { cn } from "@/lib/utils";

export function EditorTabs({
  tabs,
  activePath,
  onSelect,
  onClose,
  onReorder,
}: {
  tabs: EditorTab[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onReorder: (activePath: string, overPath: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (tabs.length === 0) return null;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tabs.map((t) => t.path)} strategy={horizontalListSortingStrategy}>
        <div
          className="flex shrink-0 items-end gap-1 overflow-x-auto border-b border-border bg-surface px-2 pt-2"
          role="tablist"
          aria-label="Open notes"
        >
          {tabs.map((tab) => (
            <SortableTab
              key={tab.path}
              tab={tab}
              active={tab.path === activePath}
              onSelect={onSelect}
              onClose={onClose}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableTab({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: EditorTab;
  active: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.path });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="tab"
      aria-selected={active}
      className={cn(
        "group relative flex h-8 max-w-[13rem] min-w-[7rem] shrink-0 items-center gap-0.5 rounded-t-lg border px-1.5 text-xs transition-colors",
        active
          ? "z-[1] -mb-px border-border border-b-bg bg-bg font-medium text-ink shadow-[0_-1px_0_0_var(--border)]"
          : "border-border/80 bg-bg/30 text-muted hover:border-border hover:bg-bg/55 hover:text-ink",
        isDragging && "z-10 opacity-95 shadow-lg",
      )}
    >
      <button
        type="button"
        className="cursor-grab rounded p-0.5 text-muted/70 opacity-0 hover:text-ink active:cursor-grabbing group-hover:opacity-100"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onSelect(tab.path)}
        className="min-w-0 flex-1 truncate py-1 text-left"
        title={tab.path}
      >
        {tab.title || tab.path}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.path);
        }}
        className={cn(
          "rounded p-0.5 text-muted transition-colors hover:bg-border/50 hover:text-ink",
          active ? "opacity-80" : "opacity-0 group-hover:opacity-100",
        )}
        aria-label={`Close ${tab.title}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
