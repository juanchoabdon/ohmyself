"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ContextResult } from "@/lib/types";

interface Message {
  role: "you" | "brain";
  text: string;
  sources?: { path: string; title: string }[];
}

export function Chat({
  token,
  open,
  onClose,
  onOpenNote,
}: {
  token: string;
  open: boolean;
  onClose: () => void;
  onOpenNote: (path: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "brain",
      text:
        "Ask me anything about you. I answer from your notes, respecting privacy. " +
        "I'll cite the notes I used so you can open them.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "you", text: q }]);
    setBusy(true);
    try {
      const ctx: ContextResult = await api.context(token, q);
      const sources = ctx.notes.map((n) => ({ path: n.path, title: n.title }));
      const text =
        sources.length === 0
          ? "I couldn't find anything relevant in your brain yet. Try adding a note."
          : `Here's what your brain has on "${q}" — drawn from ${sources.length} note${
              sources.length > 1 ? "s" : ""
            }:`;
      setMessages((m) => [...m, { role: "brain", text, sources }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "brain", text: `Error: ${err instanceof Error ? err.message : "failed"}` },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => listRef.current?.scrollTo(0, listRef.current.scrollHeight));
    }
  }

  return (
    <div
      className={`flex h-full shrink-0 flex-col border-l border-border bg-surface transition-[width] duration-200 ease-out-quart ${
        open ? "w-96" : "w-0 overflow-hidden"
      }`}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Ask your brain</h2>
        <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close chat">
          ✕
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "you" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                m.role === "you"
                  ? "bg-brand text-white"
                  : "bg-bg text-ink"
              }`}
            >
              {m.text}
            </div>
            {m.sources && m.sources.length > 0 && (
              <ul className="mt-2 space-y-1">
                {m.sources.map((s) => (
                  <li key={s.path}>
                    <button
                      onClick={() => onOpenNote(s.path)}
                      className="block w-full truncate rounded-md border border-border bg-bg px-2.5 py-1 text-left text-xs text-brand hover:bg-brand-weak"
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-muted">Thinking…</p>}
      </div>

      <form onSubmit={ask} className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(e);
              }
            }}
            rows={1}
            placeholder="What are my goals this quarter?"
            className="max-h-28 flex-1 resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}
