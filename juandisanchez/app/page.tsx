"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { MessageBubble, type ChatMessage } from "@/components/Message";
import { detectLang, strings, type Lang } from "@/lib/i18n";

const PERSON_NAME = "Juan Diego Sánchez";
const INITIALS = "JD";
const FOLLOWUP_SENTINEL = "\u0000\u0000FU\u0000\u0000";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function Page() {
  const [lang, setLang] = useState<Lang>("en");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const startedRef = useRef(false);
  const langRef = useRef<Lang>("en");

  const t = strings(lang);
  const hasUserMsg = messages.some((m) => m.role === "user");
  const lastMsg = messages[messages.length - 1];
  const lastFollowups =
    lastMsg?.role === "assistant" && lastMsg.followups ? lastMsg.followups : [];

  const setMsg = useCallback((id: string, updater: (prev: string) => string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: updater(m.content) } : m)));
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, []);

  /** Stream a reply from the agent into the assistant message `id`. */
  const stream = useCallback(
    async (payload: Record<string, unknown>, assistantId: string) => {
      setBusy(true);
      setStreamingId(assistantId);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, lang: langRef.current }),
        });

        if (!res.ok || !res.body) {
          let msg = strings(langRef.current).errorGeneric;
          if (res.status === 429) msg = strings(langRef.current).errorRate;
          else {
            try {
              const j = (await res.json()) as { error?: string };
              if (j.error) msg = j.error;
            } catch {
              /* keep generic */
            }
          }
          setMsg(assistantId, () => msg);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          const cut = acc.indexOf(FOLLOWUP_SENTINEL);
          const visible = cut === -1 ? acc : acc.slice(0, cut);
          setMsg(assistantId, () => visible);
          scrollToBottom();
        }
        // Separate the visible reply from the trailing follow-up JSON, if any.
        const cut = acc.indexOf(FOLLOWUP_SENTINEL);
        if (cut !== -1) {
          const visible = acc.slice(0, cut);
          let followups: string[] = [];
          try {
            const parsed = JSON.parse(acc.slice(cut + FOLLOWUP_SENTINEL.length));
            if (Array.isArray(parsed)) {
              followups = parsed.filter((q): q is string => typeof q === "string").slice(0, 3);
            }
          } catch {
            /* ignore malformed follow-ups */
          }
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: visible, followups } : m)),
          );
        }
      } catch {
        setMsg(assistantId, (prev) => prev || strings(langRef.current).errorGeneric);
      } finally {
        setBusy(false);
        setStreamingId(null);
        scrollToBottom();
      }
    },
    [setMsg, scrollToBottom],
  );

  const send = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const userMsg: ChatMessage = { id: uid(), role: "user", content: q };
      const assistantId = uid();
      const next = [...messages, userMsg, { id: assistantId, role: "assistant" as const, content: "" }];
      setMessages(next);
      setInput("");
      if (taRef.current) taRef.current.style.height = "auto";
      scrollToBottom();
      const history = next.filter((m) => m.content || m.role === "user").map((m) => ({ role: m.role, content: m.content }));
      void stream({ messages: history }, assistantId);
    },
    [busy, messages, stream, scrollToBottom],
  );

  // Detect language + generate the opening greeting once.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const detected = detectLang();
    setLang(detected);
    langRef.current = detected;
    const assistantId = uid();
    setMessages([{ id: assistantId, role: "assistant", content: "" }]);
    void stream({ intro: true }, assistantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onLang(next: Lang) {
    setLang(next);
    langRef.current = next;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    setInput(el.value);
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  return (
    <main className="mx-auto flex h-[100dvh] max-w-2xl flex-col px-4">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <span className="relative">
            <Avatar size={44} initials={INITIALS} glow />
            <span
              className="live-dot absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg"
              style={{ background: "var(--live)" }}
            />
          </span>
          <div className="leading-tight">
            <h1 className="font-heading text-[0.98rem] font-semibold tracking-tight">{PERSON_NAME}</h1>
            <p className="text-xs text-muted">{t.tagline}</p>
          </div>
        </div>
        <div className="flex items-center rounded-full border border-border bg-surface p-0.5 text-xs">
          {(["es", "en"] as const).map((l) => (
            <button
              key={l}
              onClick={() => onLang(l)}
              className={`rounded-full px-2.5 py-1 font-medium uppercase transition-colors ${
                lang === l ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
              aria-pressed={lang === l}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto pb-2 pt-2">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} streaming={streamingId === m.id} />
        ))}

        {/* Curated starters — shown only before the visitor asks anything */}
        {!hasUserMsg && !busy && messages.some((m) => m.role === "assistant" && m.content) && (
          <div className="msg-in pl-11">
            <p className="mb-2 text-xs font-medium text-faint">{t.suggestionsLabel}</p>
            <div className="flex flex-wrap gap-2">
              {t.suggestions.map((s) => (
                <button
                  key={s.text}
                  onClick={() => send(s.text)}
                  className="group flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-ink transition-colors hover:border-brand hover:text-brand-ink"
                >
                  <span className="text-base leading-none transition-transform duration-150 group-hover:scale-110">
                    {s.icon}
                  </span>
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dynamic follow-ups — generated from the latest answer */}
        {hasUserMsg && !busy && lastFollowups.length > 0 && (
          <div className="msg-in pl-11">
            <div className="flex flex-wrap gap-2">
              {lastFollowups.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="group flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand-ink"
                >
                  <ArrowIcon />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="pb-4 pt-2">
        <form
          onSubmit={onSubmit}
          className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-lg shadow-black/20 focus-within:border-brand"
        >
          <textarea
            ref={taRef}
            value={input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={t.placeholder}
            className="max-h-40 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-[0.95rem] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
            aria-label={t.placeholder}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label={t.send}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-white transition-transform duration-150 ease-out-quart enabled:hover:-translate-y-0.5 disabled:opacity-40"
          >
            <SendIcon />
          </button>
        </form>
        <p className="mt-2 px-1 text-center text-[0.7rem] text-faint">{t.disclaimer}</p>
      </div>
    </main>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-faint transition-colors group-hover:text-brand"
      aria-hidden
    >
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}
