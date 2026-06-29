"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { MessageBubble, type ChatMessage } from "@/components/Message";
import { detectLang, strings, type Lang } from "@/lib/i18n";

const PERSON_NAME = "Juan Diego Sánchez";
const INITIALS = "JD";
const FOLLOWUP_SENTINEL = "\u0000\u0000FU\u0000\u0000";

const SOCIALS: { label: string; href: string; icon: React.ReactNode; mail?: boolean }[] = [
  { label: "X", href: "https://x.com/jd_sanch", icon: <XLogo /> },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/juan-diego-sanchez/?locale=en", icon: <LinkedInLogo /> },
  { label: "GitHub", href: "https://github.com/juanchoabdon", icon: <GitHubLogo /> },
  { label: "Email", href: "mailto:juanchoabons@gmail.com", icon: <MailIcon />, mail: true },
];

function SocialBar() {
  return (
    <div className="flex items-center gap-0.5">
      {SOCIALS.map((s) => (
        <a
          key={s.label}
          href={s.href}
          target={s.mail ? undefined : "_blank"}
          rel={s.mail ? undefined : "noreferrer noopener"}
          aria-label={s.label}
          title={s.label}
          className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
        >
          {s.icon}
        </a>
      ))}
    </div>
  );
}

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

  // Pick the language once on load: honor a saved manual choice if present,
  // otherwise default to the visitor's BROWSER language. Then open the chat.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let chosen: Lang;
    try {
      const saved = localStorage.getItem("jds.lang");
      chosen = saved === "es" || saved === "en" ? saved : detectLang();
    } catch {
      chosen = detectLang();
    }
    setLang(chosen);
    langRef.current = chosen;
    if (typeof document !== "undefined") document.documentElement.lang = chosen;
    const assistantId = uid();
    setMessages([{ id: assistantId, role: "assistant", content: "" }]);
    void stream({ intro: true }, assistantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onLang(next: Lang) {
    setLang(next);
    langRef.current = next;
    if (typeof document !== "undefined") document.documentElement.lang = next;
    try {
      localStorage.setItem("jds.lang", next);
    } catch {
      /* storage unavailable — fine, just won't persist */
    }
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
    <main className="mx-auto flex h-[100dvh] w-full max-w-3xl flex-col px-5 sm:px-8">
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
        <div className="flex items-center gap-1.5 sm:gap-2">
          <SocialBar />
          <span className="h-5 w-px bg-border" aria-hidden />
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
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="-mr-3 flex-1 space-y-7 overflow-y-auto pb-4 pr-3 pt-3 sm:-mr-5 sm:pr-5"
        style={{ scrollbarGutter: "stable" }}
      >
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} streaming={streamingId === m.id} lang={lang} />
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

function XLogo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function GitHubLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M1.5 8.67v8.58a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3V8.67l-8.928 5.493a3 3 0 0 1-3.144 0L1.5 8.67Z" />
      <path d="M22.5 6.908V6.75a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3v.158l9.714 5.978a1.5 1.5 0 0 0 1.572 0L22.5 6.908Z" />
    </svg>
  );
}
