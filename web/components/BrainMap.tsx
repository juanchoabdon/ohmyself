"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IndexedNote, Visibility } from "@/lib/types";

/**
 * Brain Map — a force-directed "neural constellation" of the second self.
 *
 * Every note is a node; edges are derived deterministically from the brain's
 * own structure (no LLM needed):
 *   1. explicit `links` between notes  (strongest, short springs)
 *   2. folder/project hierarchy        (a note → its nearest `_index.md`)
 *   3. shared tags                      (faint, long springs; capped per node)
 *
 * Rendered on a self-contained dark canvas so the colored glow pops regardless
 * of the app's light/dark theme. Pointer: hover highlights a node + neighbours,
 * click opens the note, drag repositions, empty-drag pans, wheel zooms.
 */

type EdgeKind = "link" | "hier" | "tag" | "semantic";

interface SimNode {
  path: string;
  title: string;
  type: string;
  visibility: Visibility;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  degree: number;
  core: boolean; // the "you" nucleus (identity/about-me)
}

interface SimEdge {
  a: number;
  b: number;
  kind: EdgeKind;
  dist: number;
  strength: number;
}

/** OKLCH (L,C,H) per note type — bright enough to glow on the dark backdrop. */
const TYPE_OKLCH: Record<string, [number, number, number]> = {
  identity: [0.78, 0.17, 40], // coral — the brand / "you"
  project: [0.72, 0.13, 230], // sky
  person: [0.73, 0.19, 12], // rose
  journal: [0.83, 0.15, 80], // amber
  goal: [0.8, 0.14, 162], // mint
  skill: [0.74, 0.16, 300], // violet
  memory: [0.82, 0.13, 95], // yellow
  todo: [0.76, 0.13, 200], // cyan
  prd: [0.74, 0.15, 268], // indigo
  spec: [0.76, 0.15, 330], // magenta
  meeting: [0.78, 0.13, 195], // teal — meeting hubs
  concept: [0.8, 0.14, 110], // chartreuse — glossary
  transcript: [0.74, 0.1, 140], // green-grey
  note: [0.74, 0.03, 70], // warm neutral
};
const FALLBACK_OKLCH: [number, number, number] = [0.74, 0.03, 70];

function typeColor(type: string, alpha = 1): string {
  const [l, c, h] = TYPE_OKLCH[type] ?? FALLBACK_OKLCH;
  return `oklch(${l} ${c} ${h} / ${alpha})`;
}

const VIS_OKLCH: Record<Visibility, [number, number, number]> = {
  public: [0.7, 0.15, 150],
  private: [0.62, 0.02, 70],
  secret: [0.66, 0.2, 22],
};
function visColor(v: Visibility, alpha = 1): string {
  const [l, c, h] = VIS_OKLCH[v];
  return `oklch(${l} ${c} ${h} / ${alpha})`;
}

const EDGE_SPEC: Record<EdgeKind, { dist: number; strength: number }> = {
  link: { dist: 66, strength: 0.04 },
  hier: { dist: 52, strength: 0.06 },
  tag: { dist: 124, strength: 0.012 },
  semantic: { dist: 150, strength: 0.01 },
};
const KIND_PRIORITY: Record<EdgeKind, number> = { link: 0, hier: 1, tag: 2, semantic: 3 };

// Distinct hue for semantic "idea links" — a soft violet, dashed.
const SEMANTIC_OKLCH: [number, number, number] = [0.82, 0.13, 300];
function semanticColor(alpha = 1): string {
  const [l, c, h] = SEMANTIC_OKLCH;
  return `oklch(${l} ${c} ${h} / ${alpha})`;
}

const MAX_TAG_EDGES_PER_NODE = 3;

/** dir of a path, e.g. "a/b/c.md" → "a/b"; "x.md" → "". */
function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}
function parentDir(dir: string): string {
  const i = dir.lastIndexOf("/");
  return i === -1 ? "" : dir.slice(0, i);
}

function buildGraph(
  notes: IndexedNote[],
  semantic?: { a: string; b: string; score: number }[],
): { nodes: SimNode[]; edges: SimEdge[] } {
  const indexByPath = new Map<string, number>();
  notes.forEach((n, i) => indexByPath.set(n.path, i));

  // Map a directory → the `_index.md` note that owns it.
  const indexDir = new Map<string, string>();
  for (const n of notes) {
    if (n.path.endsWith("/_index.md") || n.path === "_index.md") {
      indexDir.set(dirOf(n.path), n.path);
    }
  }

  const edgeMap = new Map<string, SimEdge>();
  const addEdge = (pa: string, pb: string, kind: EdgeKind) => {
    if (pa === pb) return;
    const ia = indexByPath.get(pa);
    const ib = indexByPath.get(pb);
    if (ia === undefined || ib === undefined) return;
    const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
    const key = `${lo}\u0000${hi}`;
    const spec = EDGE_SPEC[kind];
    const existing = edgeMap.get(key);
    if (existing && KIND_PRIORITY[existing.kind] <= KIND_PRIORITY[kind]) return;
    edgeMap.set(key, { a: lo, b: hi, kind, dist: spec.dist, strength: spec.strength });
  };

  // 1) explicit links
  for (const n of notes) {
    for (const target of n.links ?? []) addEdge(n.path, target, "link");
  }

  // 2) hierarchy — connect each note to its nearest ancestor `_index.md`
  for (const n of notes) {
    const isIndex = n.path.endsWith("/_index.md") || n.path === "_index.md";
    // For an index, start searching from its PARENT dir (so a subproject index
    // links up to the parent project). For a normal note, its own dir counts.
    let dir = isIndex ? parentDir(dirOf(n.path)) : dirOf(n.path);
    let guard = 0;
    while (guard++ < 12) {
      const owner = indexDir.get(dir);
      if (owner && owner !== n.path) {
        addEdge(n.path, owner, "hier");
        break;
      }
      if (dir === "") break;
      dir = parentDir(dir);
    }
  }

  // 3) shared tags — top-N strongest per node, faint long springs
  const tagMembers = new Map<string, number[]>();
  notes.forEach((n, i) => {
    for (const t of n.tags ?? []) {
      const key = t.toLowerCase();
      const arr = tagMembers.get(key);
      if (arr) arr.push(i);
      else tagMembers.set(key, [i]);
    }
  });
  notes.forEach((n, i) => {
    const shared = new Map<number, number>();
    for (const t of n.tags ?? []) {
      for (const j of tagMembers.get(t.toLowerCase()) ?? []) {
        if (j === i) continue;
        shared.set(j, (shared.get(j) ?? 0) + 1);
      }
    }
    const top = [...shared.entries()].sort((p, q) => q[1] - p[1]).slice(0, MAX_TAG_EDGES_PER_NODE);
    for (const [j] of top) addEdge(n.path, notes[j]!.path, "tag");
  });

  // 4) semantic edges (embeddings) — only adds NEW pairs; explicit/hier/tag win.
  if (semantic) {
    for (const e of semantic) addEdge(e.a, e.b, "semantic");
  }

  const edges = [...edgeMap.values()];

  // Degree (all edge kinds) for node sizing.
  const degree = new Array(notes.length).fill(0);
  for (const e of edges) {
    degree[e.a]++;
    degree[e.b]++;
  }

  // Seed positions on a gentle spiral so the first frame isn't a clump.
  const nodes: SimNode[] = notes.map((n, i) => {
    const core = n.path === "identity/about-me.md";
    const a = i * 2.399963; // golden angle
    const rad = 24 + 9 * Math.sqrt(i);
    return {
      path: n.path,
      title: n.title || n.path,
      type: n.type,
      visibility: n.visibility,
      x: core ? 0 : Math.cos(a) * rad,
      y: core ? 0 : Math.sin(a) * rad,
      vx: 0,
      vy: 0,
      degree: degree[i],
      r: (core ? 7 : 3.4) + 2.1 * Math.sqrt(degree[i]),
      core,
    };
  });

  return { nodes, edges };
}

interface SemEdge {
  a: string;
  b: string;
  score: number;
}

export function BrainMap({
  notes,
  onOpenNote,
  loadSemantic,
}: {
  notes: IndexedNote[];
  onOpenNote: (path: string) => void;
  /** Fetch embeddings-derived semantic edges (called lazily on first toggle). */
  loadSemantic?: () => Promise<{ enabled: boolean; edges: SemEdge[] }>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<(dir: 1 | -1) => void>(() => {});
  const resetRef = useRef<() => void>(() => {});
  const onOpenRef = useRef(onOpenNote);
  onOpenRef.current = onOpenNote;
  // Preserve node positions across graph rebuilds (e.g. toggling idea links)
  // so the map gently adjusts instead of reshuffling.
  const posRef = useRef(new Map<string, { x: number; y: number }>());
  const [hovered, setHovered] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: SimNode } | null>(null);

  // Semantic "idea links" — off by default (they cost an embeddings call).
  const [semanticOn, setSemanticOn] = useState(false);
  const [semEdges, setSemEdges] = useState<SemEdge[]>([]);
  const [semState, setSemState] = useState<"idle" | "loading" | "ready" | "empty" | "off">("idle");

  const graph = useMemo(
    () => buildGraph(notes, semanticOn ? semEdges : undefined),
    [notes, semanticOn, semEdges],
  );
  const semanticCount = useMemo(
    () => (semanticOn ? graph.edges.filter((e) => e.kind === "semantic").length : 0),
    [graph, semanticOn],
  );

  const toggleSemantic = async () => {
    if (semanticOn) {
      setSemanticOn(false);
      return;
    }
    if (semState === "idle" && loadSemantic) {
      setSemState("loading");
      try {
        const res = await loadSemantic();
        setSemEdges(res.edges);
        setSemState(res.enabled ? (res.edges.length ? "ready" : "empty") : "off");
      } catch {
        setSemState("empty");
      }
    }
    setSemanticOn(true);
  };

  // Types actually present, for the legend (stable order from TYPE_OKLCH).
  const presentTypes = useMemo(() => {
    const set = new Set(notes.map((n) => n.type));
    const ordered = Object.keys(TYPE_OKLCH).filter((t) => set.has(t));
    const extra = [...set].filter((t) => !(t in TYPE_OKLCH)).sort();
    return [...ordered, ...extra];
  }, [notes]);

  // Mutable refs the animation loop reads without re-subscribing.
  const stateRef = useRef({
    nodes: graph.nodes,
    edges: graph.edges,
    adj: new Map<number, Set<number>>(),
    tx: 0,
    ty: 0,
    k: 1,
    alpha: 1,
    hovered: null as number | null,
    dragId: null as number | null,
    fitted: false,
  });

  // Adjacency for neighbour highlighting.
  const adjacency = useMemo(() => {
    const adj = new Map<number, Set<number>>();
    graph.nodes.forEach((_, i) => adj.set(i, new Set()));
    for (const e of graph.edges) {
      adj.get(e.a)!.add(e.b);
      adj.get(e.b)!.add(e.a);
    }
    return adj;
  }, [graph]);

  useEffect(() => {
    stateRef.current.hovered = hovered;
  }, [hovered]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const st = stateRef.current;
    st.nodes = graph.nodes;
    st.edges = graph.edges;
    st.adj = adjacency;
    st.alpha = 1;
    st.fitted = false;

    // Restore previously-settled positions so toggling idea links (or a notes
    // refresh) gently nudges the layout instead of reshuffling from scratch.
    let restored = 0;
    for (const node of st.nodes) {
      const p = posRef.current.get(node.path);
      if (p) {
        node.x = p.x;
        node.y = p.y;
        restored++;
      }
    }
    const mostlyRestored = st.nodes.length > 0 && restored >= st.nodes.length * 0.8;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      if (!st.fitted) {
        st.tx = W / 2;
        st.ty = H / 2;
        st.fitted = true;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── Physics ──────────────────────────────────────────────────────────────
    const step = (alpha: number) => {
      const ns = st.nodes;
      const n = ns.length;
      // Repulsion (all pairs — fine for personal brain sizes).
      for (let i = 0; i < n; i++) {
        const a = ns[i]!;
        for (let j = i + 1; j < n; j++) {
          const b = ns[j]!;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = (Math.random() - 0.5) * 0.5;
            dy = (Math.random() - 0.5) * 0.5;
            d2 = dx * dx + dy * dy + 0.01;
          }
          const force = (1500 * alpha) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
      // Springs.
      for (const e of st.edges) {
        const a = ns[e.a]!;
        const b = ns[e.b]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = ((d - e.dist) * e.strength * alpha) / d;
        const fx = dx * f;
        const fy = dy * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      // Gravity to centre + integrate.
      for (let i = 0; i < n; i++) {
        const node = ns[i]!;
        const g = node.core ? 0.05 : 0.012;
        node.vx += -node.x * g * alpha;
        node.vy += -node.y * g * alpha;
        if (i === st.dragId) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx *= 0.86;
        node.vy *= 0.86;
        const sp = Math.hypot(node.vx, node.vy);
        if (sp > 14) {
          node.vx = (node.vx / sp) * 14;
          node.vy = (node.vy / sp) * 14;
        }
        node.x += node.vx;
        node.y += node.vy;
      }
    };

    // Settle once up-front so the first painted frame is already organised. If
    // we restored most positions, only a light re-settle is needed.
    const settleIters = mostlyRestored ? (reduce ? 60 : 40) : reduce ? 420 : 240;
    const settleAlpha = mostlyRestored ? 0.25 : reduce ? 0.6 : 0.7;
    for (let i = 0; i < settleIters; i++) step(settleAlpha);
    st.alpha = reduce ? 0 : 0.06;

    // ── Render ───────────────────────────────────────────────────────────────
    const toScreenX = (x: number) => x * st.k + st.tx;
    const toScreenY = (y: number) => y * st.k + st.ty;

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Backdrop: deep warm radial + vignette (always dark — the planetarium).
      const bg = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
      bg.addColorStop(0, "oklch(0.21 0.018 65)");
      bg.addColorStop(1, "oklch(0.13 0.012 60)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const hov = st.hovered;
      const neighbours = hov != null ? st.adj.get(hov) : undefined;
      const isActive = (i: number) => hov == null || i === hov || !!neighbours?.has(i);

      // Edges (under nodes). Semantic "idea links" render as dashed violet so
      // they read as a softer, inferred layer distinct from real connections.
      for (const e of st.edges) {
        const a = st.nodes[e.a]!;
        const b = st.nodes[e.b]!;
        const lit = hov != null && (e.a === hov || e.b === hov);
        const dim = hov != null && !lit;
        const semantic = e.kind === "semantic";
        ctx.beginPath();
        ctx.moveTo(toScreenX(a.x), toScreenY(a.y));
        ctx.lineTo(toScreenX(b.x), toScreenY(b.y));
        if (semantic) {
          ctx.setLineDash([2.5, 4]);
          ctx.strokeStyle = semanticColor(lit ? 0.7 : dim ? 0.08 : 0.26);
          ctx.lineWidth = lit ? 1.5 : 1;
        } else if (lit) {
          ctx.setLineDash([]);
          ctx.strokeStyle = typeColor(hov === e.a ? b.type : a.type, 0.55);
          ctx.lineWidth = e.kind === "tag" ? 1 : 1.6;
        } else {
          ctx.setLineDash([]);
          const base = e.kind === "tag" ? 0.05 : 0.12;
          ctx.strokeStyle = `oklch(0.8 0.03 250 / ${dim ? base * 0.35 : base})`;
          ctx.lineWidth = e.kind === "tag" ? 0.7 : 1;
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Node glow (additive bloom).
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < st.nodes.length; i++) {
        const node = st.nodes[i]!;
        if (!isActive(i)) continue;
        const sx = toScreenX(node.x);
        const sy = toScreenY(node.y);
        const rr = node.r * st.k;
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr * 3.4);
        glow.addColorStop(0, typeColor(node.type, i === hov ? 0.55 : 0.32));
        glow.addColorStop(1, typeColor(node.type, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // Node cores + privacy ring + labels.
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i < st.nodes.length; i++) {
        const node = st.nodes[i]!;
        const active = isActive(i);
        const sx = toScreenX(node.x);
        const sy = toScreenY(node.y);
        const rr = Math.max(1.6, node.r * st.k);

        ctx.beginPath();
        ctx.arc(sx, sy, rr, 0, Math.PI * 2);
        ctx.fillStyle = typeColor(node.type, active ? 1 : 0.25);
        ctx.fill();

        // privacy ring (secret/public get a visible ring; private stays subtle)
        ctx.lineWidth = node.core ? 2.2 : 1.4;
        ctx.strokeStyle = visColor(node.visibility, active ? (node.visibility === "private" ? 0.4 : 0.9) : 0.18);
        ctx.beginPath();
        ctx.arc(sx, sy, rr + 1.8, 0, Math.PI * 2);
        ctx.stroke();

        // Labels: always for the core + high-degree nodes; for any active node on hover.
        const showLabel =
          node.core || node.degree >= 3 || (hov != null && active && st.k > 0.5);
        if (showLabel && st.k > 0.35) {
          const fontPx = node.core ? 13 : 11;
          ctx.font = `${node.core ? 650 : 520} ${fontPx}px "Plus Jakarta Sans", system-ui, sans-serif`;
          const label = node.title.length > 26 ? node.title.slice(0, 25) + "…" : node.title;
          const ly = sy + rr + 4;
          ctx.shadowColor = "oklch(0.1 0.01 60 / 0.9)";
          ctx.shadowBlur = 6;
          const labelAlpha = i === hov ? 1 : active ? 0.86 : 0.34;
          ctx.fillStyle = `oklch(0.96 0.012 80 / ${labelAlpha})`;
          ctx.fillText(label, sx, ly);
          ctx.shadowBlur = 0;
        }
      }
    };

    let raf = 0;
    const loop = () => {
      if (!reduce) {
        // gentle continuous breathing; reheats on drag
        const target = st.dragId != null ? 0.32 : 0.05;
        st.alpha += (target - st.alpha) * 0.04;
        step(st.alpha);
      }
      // Remember positions so a graph rebuild can resume from here.
      const pm = posRef.current;
      for (const node of st.nodes) pm.set(node.path, { x: node.x, y: node.y });
      draw();
      raf = requestAnimationFrame(loop);
    };
    draw();
    raf = requestAnimationFrame(loop);

    // ── Pointer interaction ────────────────────────────────────────────────
    const pointer = { x: 0, y: 0, downX: 0, downY: 0, down: false, moved: false, mode: "" as "" | "pan" | "drag" };

    const worldFromEvent = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return { sx, sy, wx: (sx - st.tx) / st.k, wy: (sy - st.ty) / st.k };
    };

    const hitTest = (sx: number, sy: number): number | null => {
      let best: number | null = null;
      let bestD = Infinity;
      for (let i = 0; i < st.nodes.length; i++) {
        const node = st.nodes[i]!;
        const dx = toScreenX(node.x) - sx;
        const dy = toScreenY(node.y) - sy;
        const d = Math.hypot(dx, dy);
        const hitR = Math.max(node.r * st.k + 6, 11);
        if (d < hitR && d < bestD) {
          best = i;
          bestD = d;
        }
      }
      return best;
    };

    const onMove = (e: PointerEvent) => {
      const { sx, sy, wx, wy } = worldFromEvent(e.clientX, e.clientY);
      pointer.x = sx;
      pointer.y = sy;
      if (pointer.down) {
        if (Math.hypot(sx - pointer.downX, sy - pointer.downY) > 3) pointer.moved = true;
        if (pointer.mode === "pan") {
          st.tx += e.movementX;
          st.ty += e.movementY;
        } else if (pointer.mode === "drag" && st.dragId != null) {
          st.nodes[st.dragId]!.x = wx;
          st.nodes[st.dragId]!.y = wy;
        }
        return;
      }
      const hit = hitTest(sx, sy);
      if (hit !== stateRef.current.hovered) setHovered(hit);
      if (hit != null) {
        const node = st.nodes[hit]!;
        setTooltip({ x: toScreenX(node.x), y: toScreenY(node.y) - node.r * st.k - 10, node });
        canvas.style.cursor = "pointer";
      } else {
        setTooltip(null);
        canvas.style.cursor = "grab";
      }
    };

    const onDown = (e: PointerEvent) => {
      const { sx, sy } = worldFromEvent(e.clientX, e.clientY);
      pointer.down = true;
      pointer.moved = false;
      pointer.downX = sx;
      pointer.downY = sy;
      const hit = hitTest(sx, sy);
      if (hit != null) {
        pointer.mode = "drag";
        st.dragId = hit;
      } else {
        pointer.mode = "pan";
        canvas.style.cursor = "grabbing";
      }
      canvas.setPointerCapture(e.pointerId);
    };

    const onUp = (e: PointerEvent) => {
      const wasDrag = pointer.mode === "drag";
      const dragId = st.dragId;
      const clicked = !pointer.moved;
      pointer.down = false;
      pointer.mode = "";
      st.dragId = null;
      canvas.style.cursor = "grab";
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (clicked && wasDrag && dragId != null) {
        onOpenRef.current(st.nodes[dragId]!.path);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const k2 = Math.min(3, Math.max(0.25, st.k * factor));
      const real = k2 / st.k;
      st.tx = cx - (cx - st.tx) * real;
      st.ty = cy - (cy - st.ty) * real;
      st.k = k2;
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", () => {
      setHovered(null);
      setTooltip(null);
    });
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.style.cursor = "grab";

    // expose zoom controls
    zoomRef.current = (dir: 1 | -1) => {
      const factor = dir === 1 ? 1.25 : 0.8;
      const cx = W / 2;
      const cy = H / 2;
      const k2 = Math.min(3, Math.max(0.25, st.k * factor));
      const real = k2 / st.k;
      st.tx = cx - (cx - st.tx) * real;
      st.ty = cy - (cy - st.ty) * real;
      st.k = k2;
    };
    resetRef.current = () => {
      st.tx = W / 2;
      st.ty = H / 2;
      st.k = 1;
      st.alpha = 0.5;
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, adjacency]);

  const empty = notes.length === 0;

  return (
    <div ref={wrapRef} className="brainmap" aria-label="Brain map of your second self">
      <canvas ref={canvasRef} className="brainmap__canvas" />

      {/* Title + counts */}
      <div className="brainmap__title">
        <span className="brainmap__title-main">Brain Map</span>
        <span className="brainmap__title-sub">
          {notes.length} {notes.length === 1 ? "note" : "notes"} · {graph.edges.length} connections
        </span>
      </div>

      {/* Legend */}
      {!empty && (
        <div className="brainmap__legend" aria-hidden>
          {presentTypes.map((t) => (
            <span key={t} className="brainmap__legend-item">
              <span className="brainmap__dot" style={{ background: typeColor(t) }} />
              {t}
            </span>
          ))}
          {semanticOn && semanticCount > 0 && (
            <span className="brainmap__legend-item">
              <span className="brainmap__dash" style={{ background: semanticColor() }} />
              idea link
            </span>
          )}
        </div>
      )}

      {/* Semantic "idea links" toggle */}
      {!empty && loadSemantic && (
        <button
          type="button"
          className={`brainmap__ideas${semanticOn ? " is-on" : ""}`}
          onClick={toggleSemantic}
          disabled={semState === "loading"}
          aria-pressed={semanticOn}
          title="Reveal AI-inferred connections between related notes"
        >
          <span className="brainmap__ideas-spark" aria-hidden>
            ✦
          </span>
          {semState === "loading"
            ? "Thinking…"
            : semanticOn && semState === "off"
              ? "Idea links · n/a"
              : semanticOn && semanticCount === 0
                ? "No idea links found"
                : semanticOn
                  ? `Idea links · ${semanticCount}`
                  : "Idea links"}
        </button>
      )}

      {/* Controls */}
      <div className="brainmap__controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomRef.current(1)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomRef.current(-1)}>
          −
        </button>
        <button type="button" aria-label="Reset view" onClick={() => resetRef.current()}>
          ⟳
        </button>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="brainmap__tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="status"
        >
          <span className="brainmap__tooltip-title">{tooltip.node.title}</span>
          <span className="brainmap__tooltip-meta">
            <span className="brainmap__dot" style={{ background: typeColor(tooltip.node.type) }} />
            {tooltip.node.type} · {tooltip.node.visibility} · {tooltip.node.degree} link
            {tooltip.node.degree === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {/* Hint */}
      {!empty && <p className="brainmap__hint">Drag to move · scroll to zoom · click a node to open it</p>}

      {empty && (
        <div className="brainmap__empty">
          <p className="brainmap__empty-title">Your map is waiting for its first thought</p>
          <p className="brainmap__empty-sub">
            Add a few notes and they&apos;ll light up here, wired together by their links, projects and tags.
          </p>
        </div>
      )}
    </div>
  );
}
