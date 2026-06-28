"use client";

import { useMemo } from "react";
import type { IndexedNote, Visibility } from "@/lib/types";
import { VisibilityBadge } from "./VisibilityBadge";

interface Props {
  notes: IndexedNote[];
  selected: string | null;
  onSelect: (path: string) => void;
  query: string;
  onQuery: (q: string) => void;
  typeFilter: string | null;
  onTypeFilter: (t: string | null) => void;
  visFilter: Visibility | null;
  onVisFilter: (v: Visibility | null) => void;
}

function topFolder(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "(root)" : path.slice(0, i);
}

export function Sidebar({
  notes,
  selected,
  onSelect,
  query,
  onQuery,
  typeFilter,
  onTypeFilter,
  visFilter,
  onVisFilter,
}: Props) {
  const types = useMemo(
    () => Array.from(new Set(notes.map((n) => n.type))).sort(),
    [notes],
  );

  const groups = useMemo(() => {
    const map = new Map<string, IndexedNote[]>();
    for (const n of notes) {
      const k = topFolder(n.path);
      const arr = map.get(k) ?? [];
      arr.push(n);
      map.set(k, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [notes]);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-surface">
      <div className="border-b border-border p-3">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search your brain…"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand"
        />
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <FilterChip active={visFilter === null && typeFilter === null} onClick={() => { onVisFilter(null); onTypeFilter(null); }}>
            All
          </FilterChip>
          {(["public", "private", "secret"] as Visibility[]).map((v) => (
            <FilterChip key={v} active={visFilter === v} onClick={() => onVisFilter(visFilter === v ? null : v)}>
              {v}
            </FilterChip>
          ))}
        </div>
        {types.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {types.map((t) => (
              <FilterChip key={t} active={typeFilter === t} onClick={() => onTypeFilter(typeFilter === t ? null : t)}>
                {t}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted">No notes match.</p>
        )}
        {groups.map(([folder, items]) => (
          <div key={folder} className="mb-3">
            <h3 className="px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
              {folder}
            </h3>
            <ul>
              {items
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((n) => (
                  <li key={n.path}>
                    <button
                      onClick={() => onSelect(n.path)}
                      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-100 ${
                        selected === n.path ? "bg-brand-weak text-ink" : "text-ink/80 hover:bg-bg"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{n.title}</span>
                      <VisibilityBadge visibility={n.visibility} />
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors duration-100 ${
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-bg text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
