"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Category, IndexedNote, Visibility } from "@/lib/types";
import { VisibilityBadge } from "./VisibilityBadge";

interface Props {
  notes: IndexedNote[];
  categories: Category[];
  /** Per-pillar note counts (shown even before a pillar's notes are loaded). */
  folderCounts: Record<string, number>;
  /** Top-level pillars whose notes have been fetched. */
  loadedFolders: Set<string>;
  /** Top-level pillars currently being fetched. */
  loadingFolders?: Set<string>;
  /** Ask the parent to lazily load a pillar's notes (on expand). */
  onExpandFolder: (folder: string) => void;
  /** Initial scaffold still loading (show skeleton). */
  loading?: boolean;
  /** A server search is in flight (show skeleton results). */
  searching?: boolean;
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

// Pillars that live in the brain (queried by planning skills / MCP) but are not
// meant to be browsed in the sidebar tree. Commitments are meeting-derived
// follow-ups, surfaced during daily/weekly planning — not a folder to scroll.
const HIDDEN_PILLARS = new Set(["commitments"]);

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

/** A leading YYYY-MM-DD in a note's filename (used by meetings/ and commitments/). */
function fileDate(node: TreeNode): string | null {
  if (node.isFolder) return null;
  const leaf = node.name.split("/").pop() ?? node.name;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(leaf);
  return m ? m[1]! : null;
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    if (!a.isFolder && !b.isFolder) {
      const ad = fileDate(a);
      const bd = fileDate(b);
      if (ad && bd) {
        if (ad !== bd) return bd.localeCompare(ad); // newest first
      } else if (ad) {
        return -1; // dated entries above undated ones
      } else if (bd) {
        return 1;
      }
    }
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
  folderCounts,
  loadedFolders,
  onExpandFolder,
  loading,
  searching,
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const canEdit = Boolean(onCreateInside || onRenameFolder || onDeleteFolder);

  // Resizable width (drag the right edge). Persisted so it survives reloads.
  const MIN_W = 240;
  const MAX_W = 640;
  const DEFAULT_W = 360;
  const [width, setWidth] = useState(DEFAULT_W);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const saved = Number(localStorage.getItem("oms-sidebar-w"));
    // Upgrade users still on the old default width so titles stay readable.
    if (saved === 288) {
      setWidth(DEFAULT_W);
      return;
    }
    if (saved >= MIN_W && saved <= MAX_W) setWidth(saved);
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const left = asideRef.current?.getBoundingClientRect().left ?? 0;
      const next = Math.min(MAX_W, Math.max(MIN_W, e.clientX - left));
      setWidth(next);
    };
    const onUp = () => setDragging(false);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);
  useEffect(() => {
    localStorage.setItem("oms-sidebar-w", String(width));
  }, [width]);

  const types = useMemo(() => Array.from(new Set(notes.map((n) => n.type))).sort(), [notes]);
  const filtering = Boolean(query.trim() || typeFilter || visFilter);
  const activeFilters = (visFilter ? 1 : 0) + (typeFilter ? 1 : 0);
  const forest = useMemo(() => buildForest(notes), [notes]);

  // Close the filters popover on outside click / Escape.
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFiltersOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

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

  // Every pillar / nested folder starts collapsed. We collapse each key the
  // first time we see it (pillars can arrive after categories — e.g. `memory`
  // only shows up via counts — and nested folders appear on expand), while
  // preserving whatever the user has manually expanded since.
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    const keys = [
      ...categories.map((c) => `__pillar__/${c.folder}`),
      ...Object.keys(folderCounts).map((f) => `__pillar__/${f}`),
      ...folderPaths,
    ];
    const fresh = keys.filter((k) => !seen.current.has(k));
    if (fresh.length === 0) return;
    for (const k of keys) seen.current.add(k);
    setCollapsed((prev) => new Set([...prev, ...fresh]));
  }, [categories, folderCounts, folderPaths]);

  // Category roots in config order, then any other pillar known from counts or
  // already-loaded notes.
  const roots = useMemo(() => {
    const ordered: string[] = [];
    const used = new Set<string>();
    for (const cat of categories) {
      if (used.has(cat.folder)) continue;
      ordered.push(cat.folder);
      used.add(cat.folder);
    }
    const extra = new Set<string>([...Object.keys(folderCounts), ...forest.keys()]);
    for (const folder of Array.from(extra).sort()) {
      if (!used.has(folder)) ordered.push(folder);
    }
    return ordered.filter((f) => !HIDDEN_PILLARS.has(f));
  }, [categories, folderCounts, forest]);

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
        const date = fileDate(node);
        return (
          <li key={node.path}>
            <button
              onClick={() => onSelect(node.path)}
              style={{ paddingLeft: pad }}
              className={`group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors duration-100 ${
                selected === node.path ? "bg-brand-weak text-ink" : "text-ink/80 hover:bg-bg"
              }`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                {date && <span className="shrink-0 tabular-nums text-[0.7rem] text-muted/70">{date}</span>}
                <span className="truncate">{node.note?.title ?? node.name}</span>
              </span>
              {node.note && <span className="shrink-0 pl-1"><VisibilityBadge visibility={node.note.visibility} /></span>}
            </button>
          </li>
        );
      }

      const open = isOpen(node.path);
      return (
        <li key={node.path}>
          <div
            style={{ paddingLeft: pad }}
            className="group relative flex w-full items-center gap-1 rounded-md py-1.5 pr-2 text-sm text-ink/90 hover:bg-bg"
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
              className="min-w-0 flex-1 overflow-hidden text-left font-medium capitalize"
            >
              <span className="block truncate">{prettyFolder(node.name)}</span>
            </button>
            <span className="flex shrink-0 items-center gap-1.5 pl-1">
              <span className="text-[0.7rem] tabular-nums text-muted/70">{countFiles(node)}</span>
              {node.note && <VisibilityBadge visibility={node.note.visibility} />}
            </span>
            {canEdit && !filtering && (
              <FolderActions
                folder={node.path}
                onCreateInside={onCreateInside}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface px-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
              />
            )}
          </div>
          {open && node.children.length > 0 && <ul>{renderNodes(node.children, depth + 1)}</ul>}
        </li>
      );
    });
  }

  return (
    <aside
      ref={asideRef}
      style={{ width }}
      className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-surface"
    >
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
        <div ref={filtersRef} className="relative flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search your self…"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand"
            />
            {searching && (
              <span className="oms-spinner absolute right-2.5 top-1/2 -translate-y-1/2" aria-hidden />
            )}
          </div>
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            aria-label="Filters"
            title="Filters"
            className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition-colors ${
              activeFilters || filtersOpen
                ? "border-brand text-brand-ink"
                : "border-border text-muted hover:text-ink"
            }`}
          >
            <FunnelIcon />
            {activeFilters > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
                {activeFilters}
              </span>
            )}
          </button>

          {filtersOpen && (
            <div className="absolute inset-x-0 top-full z-20 mt-1.5 rounded-xl border border-border bg-surface p-3 shadow-lg">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Visibility</span>
                {activeFilters > 0 && (
                  <button
                    onClick={() => {
                      onVisFilter(null);
                      onTypeFilter(null);
                    }}
                    className="text-[11px] font-medium text-brand hover:underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip active={visFilter === null} onClick={() => onVisFilter(null)}>
                  All
                </FilterChip>
                {(["public", "private", "secret"] as Visibility[]).map((v) => (
                  <FilterChip key={v} active={visFilter === v} onClick={() => onVisFilter(visFilter === v ? null : v)}>
                    {v}
                  </FilterChip>
                ))}
              </div>

              {types.length > 0 && (
                <>
                  <div className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Type</div>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip active={typeFilter === null} onClick={() => onTypeFilter(null)}>
                      All
                    </FilterChip>
                    {types.map((t) => (
                      <FilterChip
                        key={t}
                        active={typeFilter === t}
                        onClick={() => onTypeFilter(typeFilter === t ? null : t)}
                      >
                        {t}
                      </FilterChip>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {(loading && roots.length === 0) || searching ? (
          <SidebarSkeleton />
        ) : null}
        {searching ? null : roots.map((rootName) => {
          const node = forest.get(rootName);
          const items = node ? node.children : [];
          const count = folderCounts[rootName];
          const loaded = loadedFolders.has(rootName);
          const hasForestItems = items.length > 0 || Boolean(node?.note);
          // While filtering, a pillar with no matching notes is hidden entirely.
          if (filtering && !hasForestItems) return null;
          const isEmpty = count !== undefined ? count === 0 : !hasForestItems;
          const displayCount = count ?? (node ? countFiles(node) : 0);
          const pillarKey = `__pillar__/${rootName}`;
          const open = isOpen(pillarKey);
          return (
            <div key={rootName} className="mb-2">
              <h3 className="group flex items-center justify-between gap-1 rounded-md px-1 py-1 text-[0.7rem] font-semibold capitalize tracking-wide text-muted">
                <button
                  onClick={() => {
                    if (filtering) return;
                    const willOpen = collapsed.has(pillarKey);
                    toggle(pillarKey);
                    if (willOpen && !loaded) onExpandFolder(rootName);
                  }}
                  disabled={filtering}
                  aria-label={open ? "Collapse" : "Expand"}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left disabled:cursor-default"
                >
                  <span className="grid h-3.5 w-3.5 shrink-0 place-items-center text-muted/70">
                    <Chevron open={open} />
                  </span>
                  <span className="min-w-0 flex-1 overflow-hidden text-left">
                    <span className="block truncate">{titleCase(rootName)}</span>
                  </span>
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
                  {!isEmpty && (
                    <span className="text-[0.7rem] tabular-nums text-muted/60">{displayCount}</span>
                  )}
                </span>
              </h3>
              {open &&
                (isEmpty ? (
                  <p className="px-2 py-1 pl-4 text-xs italic text-muted/70">Empty — nothing here yet</p>
                ) : !loaded && !filtering ? (
                  <PillarLoading rows={Math.min(Math.max(displayCount, 1), 4)} />
                ) : (
                  <ul className="pl-3">{renderNodes(items, 0)}</ul>
                ))}
            </div>
          );
        })}
      </nav>

      {/* Drag handle on the right edge to resize the sidebar. */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => setWidth(288)}
        title="Drag to resize · double-click to reset"
        className="group absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize"
      >
        <span
          className={`absolute inset-y-0 right-1 w-px transition-colors ${
            dragging ? "bg-brand" : "bg-transparent group-hover:bg-brand/60"
          }`}
        />
      </div>
    </aside>
  );
}

/** Skeleton rows shown while a pillar's notes stream in on first expand. */
function PillarLoading({ rows }: { rows: number }) {
  return (
    <ul className="pl-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center py-1.5" style={{ paddingLeft: 8 }}>
          <span className="skeleton h-3.5 rounded" style={{ width: `${55 + ((i * 13) % 35)}%` }} />
        </li>
      ))}
    </ul>
  );
}

function FolderActions({
  folder,
  onCreateInside,
  onRenameFolder,
  onDeleteFolder,
  className,
}: {
  folder: string;
  onCreateInside?: (folder: string) => void;
  onRenameFolder?: (folder: string) => void;
  onDeleteFolder?: (folder: string) => void;
  className?: string;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <span className={`flex items-center gap-0.5 ${className ?? ""}`}>
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

function SidebarSkeleton() {
  // A few shimmering rows so loading/search feels alive instead of blank.
  const widths = ["70%", "52%", "84%", "44%", "64%", "76%", "48%"];
  return (
    <div className="space-y-1.5 p-1" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <span className="oms-skel h-2.5 w-2.5 rounded-full" />
          <span className="oms-skel h-2.5 rounded" style={{ width: w }} />
        </div>
      ))}
    </div>
  );
}

function FunnelIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 3h12l-4.5 5.5V13L6.5 11V8.5L2 3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
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
