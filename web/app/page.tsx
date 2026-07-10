"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { siClaude, siGooglecalendar, siNotion, siGmail, siWhatsapp } from "simple-icons";
import { supabase } from "@/lib/supabaseClient";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrainMap } from "@/components/BrainMap";
import type { IndexedNote } from "@/lib/types";

const GITHUB = "https://github.com/juanchoabdon/ohmyself";

type Brand = { title: string; hex: string; path: string };

// OpenAI / ChatGPT mark (simple-icons dropped it for trademark reasons), rendered in ink.
const siChatgpt: Brand = {
  title: "ChatGPT",
  hex: "0F0F0F",
  path: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.1419.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z",
};

/** True for near-black/monochrome marks (Notion, ChatGPT) that vanish on a dark
 *  surface — we render those in the theme's ink color instead of their hex. */
function isDarkMark(hex: string): boolean {
  if (hex.length !== 6) return false;
  const n = parseInt(hex, 16);
  if (Number.isNaN(n)) return false;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.22;
}

function BrandIcon({ icon, size = 18 }: { icon: Brand; size?: number }) {
  const mono = isDarkMark(icon.hex);
  return (
    <svg
      role="img"
      aria-label={icon.title}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={mono ? "currentColor" : `#${icon.hex}`}
      className={mono ? "text-ink" : undefined}
    >
      <path d={icon.path} />
    </svg>
  );
}

/** Reveal-on-scroll: add `.in` to any `.reveal` element when it enters view. */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ---------------- Mode: self ⇄ startup ---------------- */

type Mode = "self" | "startup";

const ModeCtx = createContext<Mode>("self");
const useMode = () => useContext(ModeCtx);

/** Indigo accent that repaints the whole page when the startup experience is
 *  active. Derived via color-mix so the weak tint adapts to light & dark. */
const STARTUP_ACCENT = {
  ["--brand" as string]: "oklch(0.585 0.196 273)",
  ["--brand-ink" as string]: "oklch(0.585 0.196 273)",
  ["--brand-weak" as string]: "color-mix(in oklch, oklch(0.585 0.196 273) 16%, transparent)",
} as React.CSSProperties;

export default function Landing() {
  useReveal();
  const [mode, setMode] = useState<Mode>("self");

  useEffect(() => {
    const saved = window.localStorage.getItem("landing-mode");
    if (saved === "startup" || saved === "self") setMode(saved);
  }, []);

  function choose(next: Mode) {
    setMode(next);
    window.localStorage.setItem("landing-mode", next);
  }

  return (
    <ModeCtx.Provider value={mode}>
      <div
        className="relative min-h-screen overflow-x-clip"
        style={mode === "startup" ? STARTUP_ACCENT : undefined}
      >
        <Backdrop />
        <Nav />
        <Hero mode={mode} onMode={choose} />
        <HowItWorks />
        <BrainPreview />
        <Features />
        <Privacy />
        <FinalCta />
        <Footer />
      </div>
    </ModeCtx.Provider>
  );
}

function Logo({ className = "" }: { className?: string }) {
  const mode = useMode();
  if (mode === "startup") {
    return (
      <span className={`font-display font-semibold tracking-tight ${className}`}>
        <span
          style={{
            backgroundImage:
              "linear-gradient(92deg, oklch(0.585 0.196 273), oklch(0.62 0.17 300))",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          ohmystartup
        </span>
      </span>
    );
  }
  return (
    <span className={`font-display font-semibold tracking-tight ${className}`}>
      <span className="brand-gradient">ohmyself!</span>
    </span>
  );
}

/** Big segmented control — the main selector that flips the entire landing. */
function ModeToggle({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const opts: { id: Mode; label: string; hint: string }[] = [
    { id: "self", label: "For yourself", hint: "your second self" },
    { id: "startup", label: "For your startup", hint: "your company brain" },
  ];
  return (
    <div className="inline-flex rounded-full border border-border bg-surface/80 p-1 shadow-sm backdrop-blur-sm">
      {opts.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onMode(o.id)}
            aria-pressed={active}
            className={`group relative rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-200 sm:px-5 ${
              active ? "text-white" : "text-muted hover:text-ink"
            }`}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-full bg-brand shadow-sm transition-all duration-200"
              />
            )}
            <span className="relative flex items-center gap-2">
              {o.label}
              <span
                className={`hidden text-[0.7rem] font-normal sm:inline ${
                  active ? "text-white/80" : "text-muted/70"
                }`}
              >
                {o.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="animate-blob absolute -left-24 -top-24 h-[28rem] w-[28rem] rounded-full"
        style={{ background: "var(--brand)", opacity: 0.18 }}
      />
      <div
        className="animate-blob absolute right-[-6rem] top-24 h-[24rem] w-[24rem] rounded-full"
        style={{ background: "var(--accent-amber)", opacity: 0.22, animationDelay: "-6s" }}
      />
      <div
        className="animate-blob absolute bottom-[-8rem] left-1/3 h-[26rem] w-[26rem] rounded-full"
        style={{ background: "var(--accent-pink)", opacity: 0.14, animationDelay: "-11s" }}
      />
    </div>
  );
}

function Nav() {
  const mode = useMode();
  const startup = mode === "startup";
  // null = unknown (still checking), so we render nothing auth-specific to avoid a flash.
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setAuthed(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-bg/70 backdrop-blur-md">
      <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-3.5">
        <Logo className="justify-self-start text-xl" />
        <nav className="hidden items-center justify-center gap-7 text-sm text-muted md:flex">
          <a href="#how" className="transition-colors hover:text-ink">
            How it works
          </a>
          <a href="#brain" className="transition-colors hover:text-ink">
            Brain map
          </a>
          <a href="#features" className="transition-colors hover:text-ink">
            Features
          </a>
          <a href="#privacy" className="transition-colors hover:text-ink">
            Privacy
          </a>
          <a href={GITHUB} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
            GitHub
          </a>
        </nav>
        <div className="flex min-h-[2.25rem] items-center justify-self-end gap-1.5 sm:gap-2">
          <ThemeToggle />
          {authed ? (
            <Link
              href="/app"
              className="group inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-transform duration-200 ease-out-quart hover:-translate-y-0.5 hover:opacity-95"
            >
              <span className="sm:hidden">{startup ? "My startup" : "My second self"}</span>
              <span className="hidden sm:inline">{startup ? "Go to my startup" : "Go to my second self"}</span>
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </Link>
          ) : authed === false ? (
            <>
              <Link
                href="/login?mode=signin"
                className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-ink sm:inline-flex"
              >
                Log in
              </Link>
              <Link
                href="/login?mode=signup"
                className="rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-transform duration-200 ease-out-quart hover:-translate-y-0.5 hover:opacity-95"
              >
                <span className="sm:hidden">Get started</span>
                <span className="hidden sm:inline">{startup ? "Create your startup wiki" : "Create your second self"}</span>
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function Hero({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const startup = mode === "startup";
  return (
    <section className="mx-auto max-w-6xl px-5 pb-10 pt-12 md:pt-16">
      <div className="mx-auto max-w-3xl text-center">
        <div className="reveal flex justify-center">
          <ModeToggle mode={mode} onMode={onMode} />
        </div>

        <span className="reveal mt-8 inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Open source · built on MCP
        </span>

        <h1 className="reveal mt-6 font-heading text-balance text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
          Meet <Logo className="text-5xl md:text-7xl" />
          <br />
          {startup ? "your company's brain." : "your second self."}
        </h1>

        {startup ? (
          <p className="reveal mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted">
            A shared knowledge base for everything your startup is building —
            thesis, product specs, decisions, people, GTM — kept as plain
            markdown. Then connect{" "}
            <strong className="font-semibold text-ink">Claude</strong>,{" "}
            <strong className="font-semibold text-ink">ChatGPT</strong>, or any
            agent via MCP so your whole team builds from one source of truth.
          </p>
        ) : (
          <p className="reveal mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted">
            A private knowledge base of everything about you — goals, projects,
            people, journal — kept as plain markdown. Then connect{" "}
            <strong className="font-semibold text-ink">Claude</strong>,{" "}
            <strong className="font-semibold text-ink">ChatGPT</strong>, or any agent
            via MCP, and let it answer for you — or share a public agent so anyone can ask.
          </p>
        )}

        <div className="reveal mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login?mode=signup"
            className="group inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 font-semibold text-white shadow-lg shadow-brand/25 transition-transform duration-200 ease-out-quart hover:-translate-y-0.5 hover:opacity-95"
          >
            {startup ? "Create your startup wiki" : "Create your second self"}
            <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
          <a
            href="#how"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-6 py-3 font-semibold text-ink transition-colors hover:border-brand hover:text-brand-ink"
          >
            See how it works
          </a>
        </div>

        <div className="reveal mt-14">
          <AvatarOrbit />
          <p className="mx-auto mt-6 max-w-md text-sm text-muted">
            {startup
              ? "Your company's knowledge center — feed it from your team's tools, then let any agent (or your users) talk to it."
              : "Your knowledge center — feed it from your tools, then let any agent (or other people) talk to it."}
          </p>
        </div>
      </div>
    </section>
  );
}

/** Central "you" avatar with real tool/agent logos orbiting around it. */
function AvatarOrbit() {
  const startup = useMode() === "startup";
  const tools: { label: string; icon: Brand }[] = [
    { label: "Claude", icon: siClaude },
    { label: "ChatGPT", icon: siChatgpt },
    { label: "Calendar", icon: siGooglecalendar },
    { label: "Notion", icon: siNotion },
    { label: "Gmail", icon: siGmail },
    { label: "WhatsApp", icon: siWhatsapp },
  ];
  const R = 150; // orbit radius in px
  return (
    <div className="mx-auto grid scale-[0.78] place-items-center sm:scale-100">
      <div className="relative h-[340px] w-[340px]">
        {/* dashed orbit rings */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-full border border-dashed border-border"
          style={{ animation: "ring-pulse 6s ease-in-out infinite" }}
        />
        <div
          aria-hidden
          className="absolute rounded-full border border-dashed border-border/70"
          style={{ inset: "58px", animation: "ring-pulse 6s ease-in-out infinite", animationDelay: "-3s" }}
        />

        {/* center: you */}
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="relative mx-auto h-28 w-28">
            {/* soft glow */}
            <div
              aria-hidden
              className="absolute -inset-4 rounded-full blur-2xl"
              style={{ background: "radial-gradient(closest-side, var(--brand), transparent)", opacity: 0.4 }}
            />
            {/* expanding pulse ring */}
            <div aria-hidden className="animate-pulse-soft absolute inset-1 rounded-full" />
            {/* spinning gradient halo */}
            <div
              aria-hidden
              className="absolute -inset-[3px] rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, var(--accent-pink), var(--brand), var(--accent-amber), var(--accent-pink))",
                WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))",
                mask: "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))",
                animation: "spin-slow 14s linear infinite",
                opacity: 0.95,
              }}
            />
            {/* portrait medallion */}
            <div
              className="relative grid h-28 w-28 place-items-center overflow-hidden rounded-full"
              style={{
                boxShadow:
                  "inset 0 3px 10px rgba(255,255,255,0.5), inset 0 -16px 28px oklch(0.45 0.16 28 / 0.28), 0 18px 34px oklch(0.66 0.19 38 / 0.4)",
              }}
            >
              {startup ? <CompanyAvatar className="h-full w-full" /> : <SelfAvatar className="h-full w-full" />}
              {/* glossy sheen so it still reads as a 3D orb */}
              <div aria-hidden className="pointer-events-none absolute inset-0 rounded-full border border-white/40" />
              <div aria-hidden className="pointer-events-none absolute left-5 top-3 h-5 w-10 -rotate-12 rounded-full bg-white/45 blur-md" />
            </div>
          </div>
          <div className="mt-3.5 flex justify-center">
            <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold lowercase tracking-wide text-ink shadow-sm">
              {startup ? "your co." : "you"}
            </span>
          </div>
        </div>

        {/* orbiting tools */}
        <div className="orbit-spin absolute inset-0">
          {tools.map((t, i) => {
            const a = (i / tools.length) * 360;
            return (
              <div
                key={t.label}
                className="absolute left-1/2 top-1/2"
                style={{
                  transform: `translate(-50%, -50%) rotate(${a}deg) translateY(-${R}px) rotate(${-a}deg)`,
                }}
              >
                <div className="orbit-rev">
                  <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm">
                    <BrandIcon icon={t.icon} size={16} />
                    {t.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A warm, friendly illustrated "self" — a real person, not the generic
 *  account silhouette. Fills its circular container. */
function SelfAvatar({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Your second self">
      <defs>
        <radialGradient id="sa-bg" cx="36%" cy="28%" r="85%">
          <stop offset="0" stopColor="#FFF3E9" />
          <stop offset="1" stopColor="#FFD7BE" />
        </radialGradient>
        <linearGradient id="sa-shirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF7458" />
          <stop offset="1" stopColor="#F2613E" />
        </linearGradient>
        <linearGradient id="sa-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FBD0AC" />
          <stop offset="1" stopColor="#F2BC92" />
        </linearGradient>
        <clipPath id="sa-clip">
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>
      <g clipPath="url(#sa-clip)">
        <rect width="100" height="100" fill="url(#sa-bg)" />
        <path d="M15 100 C15 80 31 70 50 70 C69 70 85 80 85 100 Z" fill="url(#sa-shirt)" />
        <path d="M43 71 Q50 78 57 71" fill="none" stroke="#DD4F2C" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
        <path d="M44 60 H56 V68 Q50 72 44 68 Z" fill="#EDB386" />
        <circle cx="31" cy="49" r="4" fill="url(#sa-skin)" />
        <circle cx="69" cy="49" r="4" fill="url(#sa-skin)" />
        <ellipse cx="50" cy="48" rx="19" ry="21" fill="url(#sa-skin)" />
        <path d="M31 48 C30 30 40 24 50 24 C60 24 70 30 69 48 C61 45 56 46 50 46 C44 46 39 45 31 48 Z" fill="#5A3B2C" />
        <circle cx="37.5" cy="54" r="3.4" fill="#FF9277" opacity="0.4" />
        <circle cx="62.5" cy="54" r="3.4" fill="#FF9277" opacity="0.4" />
        <circle cx="42.5" cy="49.5" r="3" fill="#3A2A22" />
        <circle cx="57.5" cy="49.5" r="3" fill="#3A2A22" />
        <circle cx="43.8" cy="48.4" r="1" fill="#fff" />
        <circle cx="58.8" cy="48.4" r="1" fill="#fff" />
        <path d="M44 56 Q50 60.5 56 56" fill="none" stroke="#9A5A40" strokeWidth="2.3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** A friendly "company" medallion for the startup experience — a bright glyph
 *  that reads as an org/brain rather than a single face. Fills its container. */
function CompanyAvatar({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Your company brain">
      <defs>
        <radialGradient id="ca-bg" cx="34%" cy="26%" r="90%">
          <stop offset="0" stopColor="#EEF0FF" />
          <stop offset="1" stopColor="#C7CCFF" />
        </radialGradient>
        <linearGradient id="ca-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <clipPath id="ca-clip">
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>
      <g clipPath="url(#ca-clip)">
        <rect width="100" height="100" fill="url(#ca-bg)" />
        {/* three linked nodes = a team building from one brain */}
        <g stroke="url(#ca-mark)" strokeWidth="3.4" strokeLinecap="round">
          <line x1="50" y1="38" x2="34" y2="64" />
          <line x1="50" y1="38" x2="66" y2="64" />
          <line x1="34" y1="64" x2="66" y2="64" />
        </g>
        <circle cx="50" cy="36" r="9" fill="url(#ca-mark)" />
        <circle cx="33" cy="65" r="8" fill="url(#ca-mark)" />
        <circle cx="67" cy="65" r="8" fill="url(#ca-mark)" />
        <circle cx="50" cy="36" r="3.4" fill="#fff" opacity="0.9" />
        <circle cx="33" cy="65" r="3" fill="#fff" opacity="0.9" />
        <circle cx="67" cy="65" r="3" fill="#fff" opacity="0.9" />
      </g>
    </svg>
  );
}

/* ---------------- How it works (the wow animation) ---------------- */

function HowItWorks() {
  const startup = useMode() === "startup";
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-balance text-3xl font-bold tracking-tight md:text-4xl">
          {startup ? "From scattered docs to one company brain" : "From scattered life to one mind"}
        </h2>
        <p className="mt-3 text-pretty text-muted">
          {startup
            ? "Your team's tools pour into a living markdown wiki. Then plug it into Claude, ChatGPT, or any MCP client — or share a public agent so your users can ask about your company."
            : "Your tools pour into a living markdown self. Then plug it into Claude, ChatGPT, or any MCP client — or share a public agent so anyone can ask about you."}
        </p>
      </div>

      <div className="reveal mt-14 flex flex-col items-stretch gap-5 md:flex-row md:items-center">
        <CaptureStage />
        <Connector />
        <BrainStage />
        <Connector reverse />
        <AskStage />
      </div>
    </section>
  );
}

function StageCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 rounded-2xl border border-border bg-surface/90 p-5 shadow-sm backdrop-blur-sm">
      <div className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-brand-ink">{title}</div>
        <div className="text-sm text-muted">{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function CaptureStage() {
  const startup = useMode() === "startup";
  const items: { icon: Brand | "edit" | "goal"; label: string; mode: "auto" | "you" }[] = startup
    ? [
        { icon: siGooglecalendar, label: "Meeting transcripts", mode: "auto" },
        { icon: siGmail, label: "Emails & threads", mode: "auto" },
        { icon: siNotion, label: "Docs & PRDs", mode: "auto" },
        { icon: "edit", label: "Decisions & specs", mode: "you" },
        { icon: "goal", label: "Roadmap & goals", mode: "you" },
      ]
    : [
        { icon: siGooglecalendar, label: "Meeting transcripts", mode: "auto" },
        { icon: siGmail, label: "Emails & threads", mode: "auto" },
        { icon: siNotion, label: "Docs & PRDs", mode: "auto" },
        { icon: "edit", label: "Journal & ideas", mode: "you" },
        { icon: "goal", label: "Goals & to-dos", mode: "you" },
      ];
  return (
    <StageCard
      title="Capture"
      subtitle={
        startup
          ? "Auto-synced from your team's tools — or write specs & decisions yourself"
          : "Auto-synced from your tools — or add & edit anything yourself"
      }
    >
      <div className="space-y-2.5">
        {items.map((it, i) => (
          <div
            key={it.label}
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
            style={{ animation: `card-in 0.5s both`, animationDelay: `${i * 0.14}s` }}
          >
            <span className="flex min-w-0 items-center gap-2 text-ink">
              <CaptureIcon icon={it.icon} />
              <span className="truncate">{it.label}</span>
            </span>
            {it.mode === "auto" ? (
              <span className="flex shrink-0 items-center gap-1 rounded-md bg-brand-weak px-1.5 py-0.5 text-[0.62rem] font-medium text-brand-ink">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                auto
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-[0.62rem] font-medium text-muted">
                <PencilGlyph />
                you
              </span>
            )}
          </div>
        ))}
      </div>
    </StageCard>
  );
}

function CaptureIcon({ icon }: { icon: Brand | "edit" | "goal" }) {
  if (typeof icon === "object") return <BrandIcon icon={icon} size={16} />;
  if (icon === "edit") return <PencilGlyph size={16} className="text-brand-ink" />;
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-brand-ink" aria-hidden>
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function PencilGlyph({ size = 11, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function BrainStage() {
  const startup = useMode() === "startup";
  const cards = (
    startup
      ? [
          { t: "company / thesis", v: "private" },
          { t: "product / prd-v1", v: "private" },
          { t: "finance / model", v: "secret" },
        ]
      : [
          { t: "identity / about-me", v: "private" },
          { t: "projects / ohmyself", v: "public" },
          { t: "finances / overview", v: "secret" },
        ]
  ) as { t: string; v: "public" | "private" | "secret" }[];
  return (
    <StageCard title={startup ? "Your company" : "Your self"} subtitle="Plain .md, linked & indexed">
      <div className="relative">
        <div className="animate-pulse-soft absolute inset-0 -z-0 rounded-xl" />
        <div className="relative space-y-2">
          {cards.map((c, i) => (
            <div
              key={c.t}
              className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2"
              style={{ animation: `float-y ${5 + i}s ease-in-out infinite`, animationDelay: `${i * 0.4}s` }}
            >
              <span className="font-mono text-[0.78rem] text-ink">{c.t}.md</span>
              <VisDot v={c.v} />
            </div>
          ))}
        </div>
      </div>
    </StageCard>
  );
}

function AskStage() {
  const startup = useMode() === "startup";
  return (
    <StageCard
      title="Connect & share"
      subtitle={
        startup
          ? "Any agent via MCP — or a public one for your users"
          : "Any agent via MCP — or a public one for everyone"
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-ink">
            <BrandIcon icon={siClaude} size={16} /> Claude
          </span>
          <span className="flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-ink">
            <BrandIcon icon={siChatgpt} size={16} /> ChatGPT
          </span>
          <span className="rounded-md bg-brand-weak px-2 py-1 text-[0.7rem] font-medium text-brand-ink">
            via MCP
          </span>
        </div>

        <div className="rounded-xl border border-border bg-bg p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[0.7rem] font-medium text-brand-ink">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--vis-public)" }} />
            Public agent · anyone can ask
          </div>
          <div className="ml-auto w-fit rounded-2xl rounded-br-sm bg-brand px-3 py-1.5 text-xs text-white">
            {startup ? "What is the team building this quarter?" : "What are Juan's 2026 goals?"}
          </div>
          <div className="mt-1.5 rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-1.5 text-xs text-ink">
            <span className="type-line">
              {startup ? "Shipping the v1 wiki, hiring two engineers…" : "Ship ohmyself! v1, grow the team…"}
            </span>
          </div>
        </div>
      </div>
    </StageCard>
  );
}

function VisDot({ v }: { v: "public" | "private" | "secret" }) {
  const color =
    v === "public" ? "var(--vis-public)" : v === "secret" ? "var(--vis-secret)" : "var(--vis-private)";
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {v}
    </span>
  );
}

function Connector({ reverse = false }: { reverse?: boolean }) {
  return (
    <>
      {/* desktop: horizontal track with traveling dots */}
      <div className="flow-track relative hidden h-px min-w-[3rem] flex-1 self-center bg-border md:block">
        {[0, 0.85, 1.7].map((d, i) => (
          <span
            key={i}
            className="flow-dot"
            style={{
              animationDelay: `${d}s`,
              ...(reverse ? { background: "var(--accent-sky)" } : {}),
            }}
          />
        ))}
      </div>
      {/* mobile: small vertical dotted hop */}
      <div className="mx-auto flex h-6 items-center justify-center md:hidden">
        <span className="text-lg text-brand">↓</span>
      </div>
    </>
  );
}

/* ---------------- Brain map preview ---------------- */

/** A believable example "second self" — enough notes, links, folders and shared
 *  tags that the force graph wires itself into a real little constellation.
 *  Purely illustrative; nothing here is fetched. */
const DEMO_NOTES: IndexedNote[] = [
  { path: "identity/about-me.md", title: "About me", type: "identity", visibility: "public", tags: ["bio", "identity"], links: ["identity/ambitions.md", "projects/ohmyself/_index.md", "goals/2026/_index.md", "skills/product.md"], updated: "2026-06-12" },
  { path: "identity/ambitions.md", title: "Ambitions", type: "identity", visibility: "private", tags: ["ambition", "north-star"], links: ["goals/2026/_index.md"], updated: "2026-05-30" },
  { path: "projects/ohmyself/_index.md", title: "ohmyself!", type: "project", visibility: "public", tags: ["second-brain", "mcp", "ship"], links: ["projects/ohmyself/prd-v1.md", "goals/2026/q3.md", "memory/first-launch.md"], updated: "2026-06-28" },
  { path: "projects/ohmyself/prd-v1.md", title: "v1 PRD", type: "prd", visibility: "public", tags: ["prd", "mcp"], links: ["projects/ohmyself/_index.md"], updated: "2026-06-20" },
  { path: "projects/flowya/_index.md", title: "Flowya", type: "project", visibility: "public", tags: ["productivity", "ship"], links: ["projects/flowya/ios.md", "people/cofounder.md"], updated: "2026-04-02" },
  { path: "projects/flowya/ios.md", title: "Flowya iOS", type: "project", visibility: "private", tags: ["ios", "swift", "productivity"], links: ["projects/flowya/_index.md"], updated: "2026-03-12" },
  { path: "projects/flowya/standup.md", title: "Standup notes", type: "transcript", visibility: "secret", tags: ["work"], links: ["projects/flowya/_index.md"], updated: "2026-03-10" },
  { path: "goals/2026/_index.md", title: "2026 Goals", type: "goal", visibility: "private", tags: ["goals", "2026"], links: ["goals/2026/q3.md", "identity/ambitions.md"], updated: "2026-01-04" },
  { path: "goals/2026/q3.md", title: "2026 Q3", type: "goal", visibility: "private", tags: ["goals", "2026", "ship"], links: ["todos/life.md"], updated: "2026-06-25" },
  { path: "journal/2026-06-28.md", title: "Jun 28", type: "journal", visibility: "private", tags: ["journal"], links: ["projects/ohmyself/_index.md"], updated: "2026-06-28" },
  { path: "journal/2026-06-14.md", title: "Jun 14", type: "journal", visibility: "private", tags: ["journal"], links: ["people/mentor.md"], updated: "2026-06-14" },
  { path: "people/mentor.md", title: "A. Mentor", type: "person", visibility: "private", tags: ["mentor", "relationship"], links: ["identity/ambitions.md"], updated: "2026-06-08" },
  { path: "people/cofounder.md", title: "Co-founder", type: "person", visibility: "private", tags: ["relationship", "work"], links: [], updated: "2026-05-19" },
  { path: "skills/product.md", title: "Product sense", type: "skill", visibility: "public", tags: ["product"], links: [], updated: "2026-02-11" },
  { path: "skills/typescript.md", title: "TypeScript", type: "skill", visibility: "public", tags: ["engineering"], links: [], updated: "2026-02-11" },
  { path: "memory/first-launch.md", title: "First launch", type: "memory", visibility: "private", tags: ["milestone"], links: [], updated: "2025-11-30" },
  { path: "todos/life.md", title: "Life to-dos", type: "todo", visibility: "private", tags: ["todo", "life"], links: [], updated: "2026-06-26" },
  { path: "finances/overview.md", title: "Finances", type: "note", visibility: "secret", tags: ["finance", "confidential"], links: ["goals/2026/_index.md"], updated: "2026-06-01" },
];

/** A believable example company wiki — thesis, product, market, GTM, people and
 *  decisions wired together the way an AI-native startup's brain would be. */
const DEMO_NOTES_COMPANY: IndexedNote[] = [
  { path: "company/thesis.md", title: "Thesis", type: "thesis", visibility: "private", tags: ["thesis", "north-star"], links: ["company/mission.md", "product/_index.md", "market/landscape.md"], updated: "2026-06-12" },
  { path: "company/mission.md", title: "Mission", type: "company", visibility: "public", tags: ["mission"], links: ["goals/2026/_index.md"], updated: "2026-05-30" },
  { path: "product/_index.md", title: "Product", type: "product", visibility: "private", tags: ["product", "roadmap"], links: ["product/prd-v1.md", "product/spec-agents.md", "goals/2026/_index.md"], updated: "2026-06-28" },
  { path: "product/prd-v1.md", title: "v1 PRD", type: "prd", visibility: "private", tags: ["prd"], links: ["product/_index.md", "decisions/stack.md"], updated: "2026-06-20" },
  { path: "product/spec-agents.md", title: "Agent spec", type: "spec", visibility: "private", tags: ["spec", "mcp"], links: ["product/_index.md"], updated: "2026-06-18" },
  { path: "market/landscape.md", title: "Landscape", type: "market", visibility: "private", tags: ["market", "research"], links: ["gtm/_index.md"], updated: "2026-05-02" },
  { path: "gtm/_index.md", title: "Go-to-market", type: "gtm", visibility: "private", tags: ["gtm", "growth"], links: ["gtm/pricing.md", "people/head-of-growth.md"], updated: "2026-06-01" },
  { path: "gtm/pricing.md", title: "Pricing", type: "gtm", visibility: "secret", tags: ["gtm", "pricing"], links: ["finance/model.md"], updated: "2026-06-10" },
  { path: "goals/2026/_index.md", title: "2026 Goals", type: "goal", visibility: "private", tags: ["goals", "2026"], links: ["company/thesis.md"], updated: "2026-01-04" },
  { path: "decisions/stack.md", title: "Stack decision", type: "decision", visibility: "private", tags: ["decision", "eng"], links: ["product/_index.md"], updated: "2026-04-14" },
  { path: "decisions/hiring.md", title: "Hiring bar", type: "decision", visibility: "private", tags: ["decision", "people"], links: ["people/_index.md"], updated: "2026-03-22" },
  { path: "people/_index.md", title: "Team", type: "person", visibility: "private", tags: ["people", "team"], links: ["people/cofounder.md", "people/head-of-growth.md"], updated: "2026-06-05" },
  { path: "people/cofounder.md", title: "Co-founder", type: "person", visibility: "private", tags: ["team"], links: [], updated: "2026-05-19" },
  { path: "people/head-of-growth.md", title: "Head of Growth", type: "person", visibility: "private", tags: ["team", "growth"], links: [], updated: "2026-05-19" },
  { path: "finance/model.md", title: "Financial model", type: "finance", visibility: "secret", tags: ["finance", "confidential"], links: ["goals/2026/_index.md"], updated: "2026-06-01" },
  { path: "ops/handbook.md", title: "Handbook", type: "ops", visibility: "private", tags: ["ops", "culture"], links: ["company/mission.md"], updated: "2026-02-11" },
  { path: "skills/product-sense.md", title: "Product sense", type: "skill", visibility: "public", tags: ["skill", "product"], links: [], updated: "2026-02-11" },
];

function BrainPreview() {
  const startup = useMode() === "startup";
  return (
    <section id="brain" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <div className="reveal mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Live preview · drag it around
        </span>
        <h2 className="mt-5 font-heading text-balance text-3xl font-bold tracking-tight md:text-4xl">
          {startup ? "Your whole company, as one living map" : "Your whole self, as one living map"}
        </h2>
        <p className="mt-3 text-pretty text-muted">
          {startup
            ? "Every note becomes a node. They wire themselves together by their links, their folders, and the tags they share — so your thesis, product, market, people and decisions turn into a single company brain your whole team can see."
            : "Every note becomes a node. They wire themselves together by their links, their folders, and the tags they share — so your projects, people, goals and journal turn into a single mind you can actually see."}
        </p>
      </div>

      <div className="reveal mt-12">
        <div className="relative h-[460px] overflow-hidden rounded-3xl border border-border shadow-lg shadow-brand/10 md:h-[560px]">
          <BrainMap notes={startup ? DEMO_NOTES_COMPANY : DEMO_NOTES} onOpenNote={() => {}} />
        </div>
        <p className="mx-auto mt-5 max-w-lg text-center text-sm text-muted">
          {startup ? "This is a sample company wiki." : "This is a sample second self."} Sign up and yours
          fills in as you capture — color = type, the ring = privacy (
          <span className="font-medium text-ink">public</span> /{" "}
          <span className="font-medium text-ink">private</span> /{" "}
          <span className="font-medium text-ink">{startup ? "founders-only" : "secret"}</span>).
        </p>
        <div className="mt-7 flex justify-center">
          <Link
            href="/login?mode=signup"
            className="group inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 font-semibold text-white shadow-lg shadow-brand/25 transition-transform duration-200 ease-out-quart hover:-translate-y-0.5 hover:opacity-95"
          >
            {startup ? "Map your company" : "Map your own mind"}
            <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Features ---------------- */

function Features() {
  const startup = useMode() === "startup";
  const features = startup
    ? [
        {
          title: "Markdown, not a database",
          body: "Every note is a portable .md file with frontmatter. Own it, fork it, sync it like Obsidian — no lock-in for your company's knowledge.",
        },
        {
          title: "Roles & shared access",
          body: "Invite your team. Owners, admins, and members each see the right visibility — founders-only secrets stay founders-only.",
        },
        {
          title: "Any agent, via MCP",
          body: "Plug Claude, ChatGPT, or Cursor into your company wiki to read specs, search decisions, and build — bidirectionally.",
        },
        {
          title: "Company-native structure",
          body: "New wikis seed with thesis, product, market, GTM, ops and decisions folders — the shape of an AI-native company from day zero.",
        },
        {
          title: "Search & context",
          body: "Full-text search and a context endpoint give your team's agents exactly the right notes for a question.",
        },
        {
          title: "A public agent for your users",
          body: "Expose a public agent so customers and investors can ask about your company — it only ever answers from public notes.",
        },
      ]
    : [
        {
          title: "Markdown, not a database",
          body: "Every note is a portable .md file with frontmatter. Own it, fork it, sync it like Obsidian — no lock-in.",
        },
        {
          title: "Three privacy levels",
          body: "Mark notes public, private, or secret. The agent only ever reveals what your scope allows.",
        },
        {
          title: "Any agent, via MCP",
          body: "Plug Claude, ChatGPT, or any MCP client into your second self to read, search, create, and link notes — bidirectionally.",
        },
        {
          title: "Bidirectional connectors",
          body: "Pull meeting transcripts from your calendar today; add new sources with a small connector interface.",
        },
        {
          title: "Search & context",
          body: "Full-text search and a context endpoint give agents exactly the right notes for a question.",
        },
        {
          title: "A public agent others can talk to",
          body: "Expose a public agent on your site so anyone can ask about you — it only ever answers from your public notes.",
        },
      ];
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-balance text-3xl font-bold tracking-tight md:text-4xl">
          {startup ? "A company brain that grows with the team" : "A self that actually grows with you"}
        </h2>
        <p className="mt-3 text-pretty text-muted">
          {startup
            ? "The more your team feeds it, the faster everyone builds from the same truth."
            : "The more you feed it, the better it helps you decide."}
        </p>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f, i) => (
          <div
            key={f.title}
            className="reveal rounded-2xl border border-border bg-surface/90 p-6 shadow-sm transition-transform duration-200 ease-out-quart hover:-translate-y-1"
            style={{ transitionDelay: `${(i % 3) * 60}ms` }}
          >
            <h3 className="font-heading text-lg font-semibold tracking-tight">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Privacy ---------------- */

function Privacy() {
  const startup = useMode() === "startup";
  const levels = startup
    ? [
        {
          v: "public" as const,
          title: "Public",
          body: "Anyone can ask your company's public agent — great for your site, users, and investors.",
        },
        {
          v: "private" as const,
          title: "Private",
          body: "Your team (signed in) and their agents can see and edit these.",
        },
        {
          v: "secret" as const,
          title: "Founders-only",
          body: "Cap table, finances, sensitive strategy — gated behind the highest scope.",
        },
      ]
    : [
        {
          v: "public" as const,
          title: "Public",
          body: "Anyone can ask your public agent and get these. Great for juandisanchez.com.",
        },
        {
          v: "private" as const,
          title: "Private",
          body: "Only you (signed in) and your personal agent can see and edit these.",
        },
        {
          v: "secret" as const,
          title: "Secret",
          body: "Sensitive notes — finances, secrets — gated behind the highest scope.",
        },
      ];
  return (
    <section id="privacy" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <div className="reveal rounded-3xl border border-border bg-surface/80 p-8 shadow-sm md:p-12">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-balance text-3xl font-bold tracking-tight md:text-4xl">
            {startup ? "Your team decides what it can say" : "You decide what it can say"}
          </h2>
          <p className="mt-3 text-pretty text-muted">
            One repo, three visibilities — enforced everywhere, from the API to MCP.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {levels.map((l) => (
            <div key={l.v} className="rounded-2xl border border-border bg-bg p-5">
              <VisDot v={l.v} />
              <h3 className="mt-3 font-heading text-lg font-semibold tracking-tight">{l.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{l.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  const startup = useMode() === "startup";
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <div className="reveal relative overflow-hidden rounded-3xl border border-border bg-surface p-10 text-center shadow-sm md:p-16">
        <div
          aria-hidden
          className="animate-blob absolute -right-16 -top-16 h-64 w-64 rounded-full"
          style={{ background: "var(--brand)", opacity: 0.16 }}
        />
        <h2 className="relative font-heading text-balance text-3xl font-bold tracking-tight md:text-5xl">
          Start your <Logo className="text-3xl md:text-5xl" />
        </h2>
        <p className="relative mx-auto mt-4 max-w-md text-pretty text-muted">
          {startup
            ? "New startup wikis seed with a company-native structure automatically. Private by default — you choose what your users can see."
            : "New accounts get a starter second self seeded automatically. Private by default — you choose what becomes public."}
        </p>
        <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login?mode=signup"
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 font-semibold text-white shadow-lg shadow-brand/25 transition-transform duration-200 ease-out-quart hover:-translate-y-0.5"
          >
            {startup ? "Create your startup wiki →" : "Create your second self →"}
          </Link>
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-6 py-3 font-semibold text-ink transition-colors hover:border-brand hover:text-brand-ink"
          >
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const startup = useMode() === "startup";
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-muted sm:flex-row">
        <Logo className="text-base" />
        <p>{startup ? "Your company's brain — view it, search it, ask it." : "Your second self — view it, search it, ask it."}</p>
        <a href={GITHUB} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
          Open source
        </a>
      </div>
    </footer>
  );
}
