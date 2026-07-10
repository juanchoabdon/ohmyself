"use client";

import { useEffect, useState } from "react";
import { SPACE_PALETTE } from "./SpaceSwitcher";

export interface CreateSpaceValues {
  name: string;
  themeColor: string;
  logoUrl?: string;
}

/** Self-serve creation of a company wiki: name it, pick an accent, optionally
 *  give it a logo. The default company sections are seeded server-side, so it
 *  opens pre-populated — the modal only collects identity + branding. */
export function CreateSpaceDialog({
  busy,
  error,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (values: CreateSpaceValues) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SPACE_PALETTE[0]!.value);
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const canSubmit = name.trim().length > 0 && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-ink">Create a company wiki</h2>
          <p className="mt-0.5 text-sm text-muted">
            A shared second brain for your startup — thesis, product, market, people. It opens with the
            AI-native starter sections already in place.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && onSubmit({ name, themeColor: color, logoUrl: logoUrl.trim() || undefined })}
              placeholder="e.g. Bonds"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Accent</span>
            <div className="flex flex-wrap gap-2">
              {SPACE_PALETTE.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setColor(p.value)}
                  title={p.label}
                  aria-label={p.label}
                  aria-pressed={color === p.value}
                  className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-surface transition-all ${
                    color === p.value ? "ring-ink" : "ring-transparent hover:ring-border"
                  }`}
                  style={{ background: p.value }}
                />
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
              Logo URL <span className="font-normal normal-case text-muted/70">(optional)</span>
            </span>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…/logo.png"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand"
            />
          </label>

          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit({ name, themeColor: color, logoUrl: logoUrl.trim() || undefined })}
            disabled={!canSubmit}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
            style={{ background: color }}
          >
            {busy ? "Creating…" : "Create wiki"}
          </button>
        </div>
      </div>
    </div>
  );
}
