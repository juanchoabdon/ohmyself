"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Category, IndexedNote, Visibility } from "@/lib/types";
import { VisibilityBadge } from "./VisibilityBadge";

interface Props {
  notes: IndexedNote[];
  categories: Category[];
  selected: string | null;
  onSelect: (path: string) => void;
  query: string;
  onQuery: (q: string) => void;
  typeFilter: string | null;
  onTypeFilter: (t: string | null) => void;
  visFilter: Visibility | null;
  onVisFilter: (v: Visibility | null) => void;
  onCreateInside?: (folder: string | null) => void;
  onRenameFolder?: (folder: string) => void;
  onDeleteFolder?: (folder: string) => void;
}

interface TreeNode {
  name: string; // path segment (folder) — files use their note title for display
  path: string; // folder path, or the note path for files
  isFolder: boolean;
  note?: IndexedNote; // file node, or a folder's own `_index.md`
  children: TreeNode[];
}

function buildForest(notes: IndexedNote[]): Map<string, TreeNode> {
  const roots = new Map<string, TreeNode>();
  const childFolder = (parent: TreeNode, name: string, path: string): TreeNode => {
    let n = parent.children.find((c) => c.isFolder && c.name === name);
    if (!n) {
      n = { name, path, isFolder: true, children: [] };
      parent.children.push(n);
    }
    return n;
  };

  for (const note of notes) {
    const segs = note.path.split("/").filter(Boolean);
    if (segs.length === 0) continue;
    const rootName = segs[0]!;
    let root = roots.get(rootName);
    if (!root) {
      root = { name: rootName, path: rootName, isFolder: true, children: [] };
      roots.set(rootName, root);
    }
    let cur = root;
    let acc = rootName;
    for (let i = 1; i < segs.length - 1; i++) {
      acc += `/${segs[i]}`;
      cur = childFolder(cur, segs[i]!, acc);
    }
    const leaf = segs[segs.length - 1]!;
    if (leaf === "_index.md") {
      cur.note = note; // this folder's overview page
    } else {
      cur.children.push({ name: leaf, path: note.path, isFolder: false, children: [], note });
    }
  }
  return roots;
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    const an = a.isFolder ? a.name : a.note?.title ?? a.name;
    const bn = b.isFolder ? b.name : b.note?.title ?? b.name;
    return an.localeCompare(bn);
  });
}

function countFiles(node: TreeNode): number {
  let c = node.isFolder ? (node.note ? 1 : 0) : 1;
  for (const ch of node.children) c += countFiles(ch);
  return c;
}

function prettyFolder(name: string): string {
  return name.replace(/[-_]/g, " ");
}

function titleCase(name: string): string {
  return prettyFolder(name).replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Sidebar({
  notes,
  categories,
  selected,
  onSelect,
  query,
  onQuery,
  typeFilter,
  onTypeFilter,
  visFilter,
  onVisFilter,
  onCreateInside,
  onRenameFolder,
  onDeleteFolder,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const canEdit = Boolean(onCreateInside || onRenameFolder || onDeleteFolder);

  const types = useMemo(() => Array.from(new Set(notes.map((n) => n.type))).sort(), [notes]);
  const filtering = Boolean(query.trim() || typeFilter || visFilter);
  const forest = useMemo(() => buildForest(notes), [notes]);

  // Every nested folder path — used to collapse all folders by default.
  const folderPaths = useMemo(() => {
    const paths: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.isFolder) {
          paths.push(n.path);
          walk(n.children);
        }
      }
    };
    for (const root of forest.values()) walk(root.children);
    return paths;
  }, [forest]);

  // Collapse all folders (pillars + nested) once notes first load.
  // Pillar keys come from categories (covers empty ones too, not just forest).
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && notes.length > 0) {
      initialized.current = true;
      const pillarKeys = categories.map((c) => `__pillar__/${c.folder}`);
      setCollapsed(new Set([...pillarKeys, ...folderPaths]));
    }
  }, [notes, categories, folderPaths]);

  // Category roots in config order, then any extra folders found in notes.
  const roots = useMemo(() => {
    const ordered: string[] = [];
    const used = new Set<string>();
    for (const cat of categories) {
      if (used.has(cat.folder)) continue;
      ordered.push(cat.folder);
      used.add(cat.folder);
    }
    for (const folder of Array.from(forest.keys()).sort()) {
      if (!used.has(folder)) ordered.push(folder);
    }
    return ordered;
  }, [categories, forest]);

  const isOpen = (path: string) => filtering || !collapsed.has(path);
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  function renderNodes(nodes: TreeNode[], depth: number): React.ReactNode {
    return sortNodes(nodes).map((node) => {
      const pad = 8 + depth * 14;
      if (!node.isFolder) {
        return (
          <li key={node.path}>
            <button
              onClick={() => onSelect(node.path)}
              style={{ paddingLeft: pad }}
              className={`group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors duration-100 ${
                selected === node.path ? "bg-brand-weak text-ink" : "text-ink/80 hover:bg-bg"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{node.note?.title ?? node.name}</span>
              {node.note && <VisibilityBadge visibility={node.note.visibility} />}
            </button>
          </li>
        );
      }

      const open = isOpen(node.path);
      return (
        <li key={node.path}>
          <div
            style={{ paddingLeft: pad }}
            className="group flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-sm text-ink/90 hover:bg-bg"
          >
            <button
              onClick={() => toggle(node.path)}
              aria-label={open ? "Collapse" : "Expand"}
              className="grid h-4 w-4 shrink-0 place-items-center text-muted"
            >
              <Chevron open={open} />
            </button>
            <button
              onClick={() => (node.note ? onSelect(node.note.path) : toggle(node.path))}
              className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left font-medium capitalize"
            >
              <span className="truncate">{prettyFolder(node.name)}</span>
            </button>
            {canEdit && !filtering && (
              <FolderActions
                folder={node.path}
                onCreateInside={onCreateInside}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
              />
            )}
            <span className="shrink-0 text-[0.7rem] tabular-nums text-muted/70">{countFiles(node)}</span>
            {node.note && <VisibilityBadge visibility={node.note.visibility} />}
          </div>
          {open && node.children.length > 0 && <ul>{renderNodes(node.children, depth + 1)}</ul>}
        </li>
      );
    });
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-surface">
      <div className="border-b border-border p-3">
        {canEdit && onCreateInside && (
          <button
            onClick={() => onCreateInside(null)}
            className="mb-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-95"
          >
            <PlusIcon />
            New entry
          </button>
        )}
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search your self…"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand"
        />
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <FilterChip
            active={visFilter === null && typeFilter === null}
            onClick={() => {
              onVisFilter(null);
              onTypeFilter(null);
            }}
          >
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
        {roots.map((rootName) => {
          const node = forest.get(rootName);
          const items = node ? node.children : [];
          const isEmpty = items.length === 0 && !node?.note;
          if (filtering && isEmpty) return null;
          const pillarKey = `__pillar__/${rootName}`;
          const open = isOpen(pillarKey);
          return (
            <div key={rootName} className="mb-2">
              <h3 className="group flex items-center justify-between gap-1 rounded-md px-1 py-1 text-[0.7rem] font-semibold capitalize tracking-wide text-muted">
                <button
                  onClick={() => toggle(pillarKey)}
                  disabled={filtering}
                  aria-label={open ? "Collapse" : "Expand"}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left disabled:cursor-default"
                >
                  <span className="grid h-3.5 w-3.5 shrink-0 place-items-center text-muted/70">
                    <Chevron open={open} />
                  </span>
                  <span className="truncate">{titleCase(rootName)}</span>
                </button>
                <span className="flex shrink-0 items-center gap-1.5">
                  {node?.note && (
                    <button
                      onClick={() => onSelect(node.note!.path)}
                      className="text-[0.65rem] font-medium normal-case text-brand-ink hover:underline"
                    >
                      overview
                    </button>
                  )}
                  {canEdit && !filtering && onCreateInside && (
                    <button
                      onClick={() => onCreateInside(rootName)}
                      title={`New entry in ${rootName}`}
                      aria-label={`New entry in ${rootName}`}
                      className="grid h-4 w-4 place-items-center rounded text-muted opacity-0 transition-opacity hover:bg-bg hover:text-ink group-hover:opacity-100"
                    >
                      <PlusIcon />
                    </button>
                  )}
                </span>
              </h3>
              {open &&
                (isEmpty ? (
                  <p className="px-2 py-1 pl-4 text-xs italic text-muted/70">Empty — nothing here yet</p>
                ) : (
                  <ul className="pl-3">{renderNodes(items, 0)}</ul>
                ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function FolderActions({
  folder,
  onCreateInside,
  onRenameFolder,
  onDeleteFolder,
}: {
  folder: string;
  onCreateInside?: (folder: string) => void;
  onRenameFolder?: (folder: string) => void;
  onDeleteFolder?: (folder: string) => void;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      {onCreateInside && (
        <IconBtn label="New entry here" onClick={stop(() => onCreateInside(folder))}>
          <PlusIcon />
        </IconBtn>
      )}
      {onRenameFolder && (
        <IconBtn label="Rename folder" onClick={stop(() => onRenameFolder(folder))}>
          <PencilIcon />
        </IconBtn>
      )}
      {onDeleteFolder && (
        <IconBtn label="Delete folder" danger onClick={stop(() => onDeleteFolder(folder))}>
          <TrashIcon />
        </IconBtn>
      )}
    </span>
  );
}

function IconBtn({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid h-5 w-5 place-items-center rounded hover:bg-bg ${
        danger ? "text-muted hover:text-vis-secret" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <path d="M6 1.5v9M1.5 6h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden>
      <path
        d="M9.5 1.8 12.2 4.5 4.7 12 2 12.4 2.4 9.7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" aria-hidden>
      <path
        d="M2.5 3.5h9M5 3.5V2.2h4V3.5M3.4 3.5l.5 8.1h6.2l.5-8.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
        active ? "border-brand bg-brand text-white" : "border-border bg-bg text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
