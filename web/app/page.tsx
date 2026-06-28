"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

const GITHUB = "https://github.com/juanchoabdon/ohmyself";

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

export default function Landing() {
  useReveal();

  return (
    <div className="relative min-h-screen overflow-x-clip">
      <Backdrop />
      <Nav />
      <Hero />
      <HowItWorks />
      <Features />
      <Privacy />
      <FinalCta />
      <Footer />
    </div>
  );
}

function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-semibold tracking-tight ${className}`}>
      <span className="brand-gradient">ohmyself!</span>
    </span>
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
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-bg/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Logo className="text-xl" />
        <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
          <a href="#how" className="transition-colors hover:text-ink">
            How it works
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
        <Link
          href="/app"
          className="rounded-lg border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-ink shadow-sm transition-colors hover:border-brand hover:text-brand-ink"
        >
          Open app
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  const sources = ["Calendar", "Journal", "Projects", "People", "Finances", "MCP"];
  return (
    <section className="mx-auto max-w-6xl px-5 pb-10 pt-16 md:pt-24">
      <div className="mx-auto max-w-3xl text-center">
        <span className="reveal inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Markdown second brain · open source
        </span>

        <h1 className="reveal mt-6 font-heading text-balance text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
          Everything about you,
          <br />
          in one <Logo className="text-5xl md:text-7xl" />
        </h1>

        <p className="reveal mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted">
          Capture your goals, projects, people, and journal as plain markdown.
          Keep it private, make parts public, and let your agents reason over all
          of it through one brain.
        </p>

        <div className="reveal mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login"
            className="group inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 font-semibold text-white shadow-lg shadow-brand/25 transition-transform duration-200 ease-out-quart hover:-translate-y-0.5 hover:opacity-95"
          >
            Create your brain
            <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
          <a
            href="#how"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-6 py-3 font-semibold text-ink transition-colors hover:border-brand hover:text-brand-ink"
          >
            See how it works
          </a>
        </div>

        <div className="reveal mt-12 flex flex-wrap items-center justify-center gap-2.5">
          {sources.map((s, i) => (
            <span
              key={s}
              className="animate-float rounded-full border border-border bg-surface/90 px-3.5 py-1.5 text-sm text-ink shadow-sm"
              style={{ animationDelay: `${i * 0.5}s` }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- How it works (the wow animation) ---------------- */

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-balance text-3xl font-bold tracking-tight md:text-4xl">
          From scattered life to one mind
        </h2>
        <p className="mt-3 text-pretty text-muted">
          Your tools pour into a living markdown brain. Ask it anything — it
          answers with everything it&apos;s allowed to share.
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
  const items = [
    { label: "Meeting transcript", tag: "calendar" },
    { label: "Daily journal", tag: "journal" },
    { label: "Project PRD", tag: "project" },
  ];
  return (
    <StageCard title="Capture" subtitle="Connectors & MCP feed it">
      <div className="space-y-2.5">
        {items.map((it, i) => (
          <div
            key={it.label}
            className="flex items-center justify-between rounded-lg border border-border bg-bg px-3 py-2 text-sm"
            style={{ animation: `card-in 0.5s both`, animationDelay: `${i * 0.18}s` }}
          >
            <span className="text-ink">{it.label}</span>
            <span className="text-[0.7rem] text-muted">{it.tag}</span>
          </div>
        ))}
      </div>
    </StageCard>
  );
}

function BrainStage() {
  const cards = [
    { t: "identity / about-me", v: "private" },
    { t: "projects / ohmyself", v: "public" },
    { t: "finances / overview", v: "secret" },
  ] as const;
  return (
    <StageCard title="Your brain" subtitle="Plain .md, linked & indexed">
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
  return (
    <StageCard title="Ask" subtitle="Public agent or your private one">
      <div className="space-y-2.5">
        <div className="ml-auto w-fit rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white">
          What are Juan&apos;s 2026 goals?
        </div>
        <div className="rounded-2xl rounded-bl-sm border border-border bg-bg px-3 py-2 text-sm text-ink">
          <span className="type-line">Ship ohmyself! v1, grow the team…</span>
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

/* ---------------- Features ---------------- */

function Features() {
  const features = [
    {
      title: "Markdown, not a database",
      body: "Every note is a portable .md file with frontmatter. Own it, fork it, sync it like Obsidian — no lock-in.",
    },
    {
      title: "Three privacy levels",
      body: "Mark notes public, private, or secret. The agent only ever reveals what your scope allows.",
    },
    {
      title: "MCP built in",
      body: "Connect Claude or any MCP client to read, search, create, and link notes — write back to your brain.",
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
      title: "Multi-tenant & in the cloud",
      body: "Sign up and get a starter brain, reachable from web, iOS, or your personal agent.",
    },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="font-heading text-balance text-3xl font-bold tracking-tight md:text-4xl">
          A brain that actually grows with you
        </h2>
        <p className="mt-3 text-pretty text-muted">
          The more you feed it, the better it helps you decide.
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
  const levels = [
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
            You decide what it can say
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
          New accounts get a starter brain seeded automatically. Private by
          default — you choose what becomes public.
        </p>
        <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 font-semibold text-white shadow-lg shadow-brand/25 transition-transform duration-200 ease-out-quart hover:-translate-y-0.5"
          >
            Create your brain →
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
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-muted sm:flex-row">
        <Logo className="text-base" />
        <p>Your second brain — view it, search it, ask it.</p>
        <a href={GITHUB} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
          Open source
        </a>
      </div>
    </footer>
  );
}
