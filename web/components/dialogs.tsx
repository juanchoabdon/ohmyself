"use client";

import { useEffect, useRef, useState } from "react";
import type { Visibility } from "@/lib/types";

/** Shared modal shell: centered card, backdrop, Escape to close. */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  destructive = true,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="text-sm leading-relaxed text-muted">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
            destructive ? "bg-vis-secret hover:opacity-95" : "bg-brand hover:opacity-95"
          }`}
        >
          {busy ? "…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function PromptDialog({
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "Save",
  busy = false,
  onSubmit,
  onClose,
}: {
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        {label && <label className="mb-1 block text-sm font-medium text-ink">{label}</label>}
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-ink focus:border-brand"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export interface CreateEntryValues {
  title: string;
  type: string;
  visibility: Visibility;
  body: string;
}

export function CreateEntryDialog({
  folder,
  defaultType,
  busy = false,
  error,
  onSubmit,
  onClose,
}: {
  folder: string | null;
  defaultType: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (values: CreateEntryValues) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState(defaultType);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [body, setBody] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <Modal title={folder ? `New entry in ${folder}` : "New entry"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onSubmit({ title: title.trim(), type: type.trim() || "note", visibility, body });
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Title</label>
          <input
            ref={ref}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Q3 planning"
            className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-ink focus:border-brand"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Type</label>
            <input
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-ink focus:border-brand"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-ink focus:border-brand"
            >
              <option value="public">public</option>
              <option value="private">private</option>
              <option value="secret">secret</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Content (markdown)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Write anything…"
            className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-[0.85rem] leading-relaxed text-ink focus:border-brand"
          />
        </div>
        {error && <p className="rounded-md bg-vis-secret/10 px-3 py-2 text-sm text-vis-secret">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
