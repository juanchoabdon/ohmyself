"use client";

import { useMemo } from "react";
import { FileText, Map as MapIcon, Plus, Sparkles } from "lucide-react";
import type { IndexedNote, Space } from "@/lib/types";
import type { EditorTab } from "@/lib/editorTabs";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";

export function CommandPalette({
  open,
  onClose,
  notes,
  spaces,
  activeSpaceId,
  recentTabs,
  onOpenNote,
  onNewNote,
  onToggleMap,
  onSwitchSpace,
}: {
  open: boolean;
  onClose: () => void;
  notes: IndexedNote[];
  spaces: Space[];
  activeSpaceId: string | null;
  recentTabs: EditorTab[];
  onOpenNote: (path: string) => void;
  onNewNote: () => void;
  onToggleMap: () => void;
  onSwitchSpace: (space: Space) => void;
}) {
  const noteByPath = useMemo(() => new Map(notes.map((n) => [n.path, n])), [notes]);

  const recentNotes = useMemo(
    () =>
      recentTabs
        .slice()
        .reverse()
        .map((t) => noteByPath.get(t.path) ?? { path: t.path, title: t.title, type: "", visibility: "private" as const, tags: [], links: [] }),
    [recentTabs, noteByPath],
  );

  function run(action: () => void) {
    action();
    onClose();
  }

  if (!open) return null;

  return (
    <CommandDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <CommandInput placeholder="Search notes, actions, spaces…" />
      <CommandList>
        <CommandEmpty>No matches</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(onNewNote)}>
            <Plus className="h-4 w-4 text-muted" />
            <span>New entry…</span>
          </CommandItem>
          <CommandItem onSelect={() => run(onToggleMap)}>
            <MapIcon className="h-4 w-4 text-muted" />
            <span>Open brain map</span>
          </CommandItem>
        </CommandGroup>

        {recentNotes.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent">
              {recentNotes.slice(0, 6).map((n) => (
                <CommandItem key={`recent-${n.path}`} value={`recent ${n.title} ${n.path}`} onSelect={() => run(() => onOpenNote(n.path))}>
                  <Sparkles className="h-4 w-4 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  <span className="truncate text-xs text-muted">{n.path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {spaces.filter((s) => s.id !== activeSpaceId).length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Spaces">
              {spaces
                .filter((s) => s.id !== activeSpaceId)
                .map((s) => (
                  <CommandItem key={s.id} value={`space ${s.name}`} onSelect={() => run(() => onSwitchSpace(s))}>
                    <span className="min-w-0 flex-1 truncate">Switch to {s.name}</span>
                    <span className="text-xs text-muted">{s.kind}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Notes">
          {notes.slice(0, 80).map((n) => (
            <CommandItem
              key={n.path}
              value={`${n.title} ${n.path}`}
              keywords={[n.path, n.type, ...n.tags]}
              onSelect={() => run(() => onOpenNote(n.path))}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{n.title}</span>
              <span className="truncate text-xs text-muted">{n.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[10px] text-muted">
        <span>Navigate with ↑↓ · Enter to open</span>
        <Kbd>esc</Kbd>
      </div>
    </CommandDialog>
  );
}
