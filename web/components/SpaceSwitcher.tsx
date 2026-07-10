"use client";

import { useEffect, useRef, useState } from "react";
import type { Space } from "@/lib/types";

/** A curated accent palette for spaces. Values are oklch so they blend well with
 *  the app's color-mix theming (weak tint + readable ink are derived at runtime). */
export const SPACE_PALETTE: { id: string; label: string; value: string }[] = [
  { id: "coral", label: "Coral", value: "oklch(0.66 0.19 38)" },
  { id: "amber", label: "Amber", value: "oklch(0.78 0.15 75)" },
  { id: "emerald", label: "Emerald", value: "oklch(0.7 0.14 165)" },
  { id: "sky", label: "Sky", value: "oklch(0.68 0.14 230)" },
  { id: "violet", label: "Violet", value: "oklch(0.62 0.19 290)" },
  { id: "rose", label: "Rose", value: "oklch(0.68 0.2 12)" },
  { id: "slate", label: "Slate", value: "oklch(0.58 0.04 260)" },
];

/** Apply a space's accent to the document root (or revert to the default coral
 *  when `color` is null). Derives a coherent weak-tint + readable ink so the
 *  whole UI re-skins from a single chosen hue, in both light and dark themes. */
export function applySpaceAccent(color: string | null): void {
  const root = document.documentElement;
  if (!color) {
    root.style.removeProperty("--brand");
    root.style.removeProperty("--brand-weak");
    root.style.removeProperty("--brand-ink");
    return;
  }
  root.style.setProperty("--brand", color);
  root.style.setProperty("--brand-weak", "color-mix(in oklch, var(--brand) 16%, transparent)");
  root.style.setProperty("--brand-ink", "color-mix(in oklch, var(--brand) 68%, var(--ink) 32%)");
}

/** The app's default accent (coral) — used when a space hasn't picked its own. */
const DEFAULT_ACCENT = "oklch(0.66 0.19 38)";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** What to show for a space: the self space uses its nickname (falling back to
 *  the product name), companies use their given name. */
export function spaceLabel(space: Space): string {
  const name = space.name?.trim();
  if (name) return name;
  return space.kind === "self" ? "ohmyself!" : "Untitled";
}

/** A square brand avatar: the logo if set, else a monogram on the space's OWN
 *  accent — never the active brand, so every row reads its true color. */
function SpaceAvatar({ space, size = 26 }: { space: Space; size?: number }) {
  if (space.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={space.logoUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-md object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const bg = space.themeColor ?? DEFAULT_ACCENT;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initials(spaceLabel(space))}
    </span>
  );
}

export function SpaceSwitcher({
  spaces,
  activeSpaceId,
  onSwitch,
  onCreate,
}: {
  spaces: Space[];
  activeSpaceId: string | null;
  onSwitch: (space: Space) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = spaces.find((s) => s.id === activeSpaceId) ?? spaces.find((s) => s.kind === "self") ?? spaces[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!active) return null;
  const companies = spaces.filter((s) => s.kind === "company");

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-bg"
        title="Switch space"
      >
        <SpaceAvatar space={active} />
        <span className="flex flex-col items-start leading-tight">
          <span className="font-display text-sm font-semibold tracking-tight text-brand-ink">
            {spaceLabel(active)}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
            {active.kind === "company" ? "Company" : "Personal"}
          </span>
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="text-muted transition-transform group-hover:text-ink"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="animate-[fadeIn_.12s_ease-out] absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-xl"
        >
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Personal</p>
          {spaces
            .filter((s) => s.kind === "self")
            .map((s) => (
              <SpaceRow key={s.id} space={s} active={s.id === active.id} onClick={() => { onSwitch(s); setOpen(false); }} />
            ))}

          {companies.length > 0 && (
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Companies</p>
          )}
          {companies.map((s) => (
            <SpaceRow key={s.id} space={s} active={s.id === active.id} onClick={() => { onSwitch(s); setOpen(false); }} />
          ))}

          <div className="my-1 border-t border-border" />
          <button
            role="menuitem"
            onClick={() => { onCreate(); setOpen(false); }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-ink hover:bg-bg"
          >
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-dashed border-border text-muted">
              +
            </span>
            Create a company wiki
          </button>
        </div>
      )}
    </div>
  );
}

function SpaceRow({ space, active, onClick }: { space: Space; active: boolean; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-brand-weak text-brand-ink" : "text-ink hover:bg-bg"
      }`}
    >
      <SpaceAvatar space={space} />
      <span className="min-w-0 flex-1 truncate font-medium">{spaceLabel(space)}</span>
      {active && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}
