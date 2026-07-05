"use client";

import Link from "next/link";
import { Avatar } from "./Avatar";
import { strings, type Lang } from "@/lib/i18n";

const PERSON_NAME = "Juan Diego Sánchez";
const INITIALS = "JD";

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

function NavTabs({ active, chatLabel, brainLabel }: { active: "chat" | "brain"; chatLabel: string; brainLabel: string }) {
  return (
    <div className="flex items-center rounded-full border border-border bg-surface p-0.5 text-xs">
      <Link
        href="/"
        aria-current={active === "chat" ? "page" : undefined}
        className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
          active === "chat" ? "bg-brand text-white" : "text-muted hover:text-ink"
        }`}
      >
        {chatLabel}
      </Link>
      <Link
        href="/brain"
        aria-current={active === "brain" ? "page" : undefined}
        className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
          active === "brain" ? "bg-brand text-white" : "text-muted hover:text-ink"
        }`}
      >
        {brainLabel}
      </Link>
    </div>
  );
}

/** Shared top bar for both the chat (`/`) and Second Brain (`/brain`) views —
 *  same identity, same nav, same language switch, so moving between the two
 *  feels like one app with two tabs rather than a different site. */
export function SiteHeader({
  lang,
  onLang,
  active,
}: {
  lang: Lang;
  onLang: (next: Lang) => void;
  active: "chat" | "brain";
}) {
  const t = strings(lang);
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 py-4">
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
        <NavTabs active={active} chatLabel={t.navChat} brainLabel={t.navBrain} />
        <span className="h-5 w-px bg-border" aria-hidden />
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
