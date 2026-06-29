"use client";

import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Lang } from "@/lib/i18n";

/**
 * The agent's "mini UI library". Beyond polished Markdown, the model can emit
 * fenced blocks that we upgrade into real components:
 *   ```card  → a project/product card (single-line JSON)
 *   ```link  → a prominent link button (single-line JSON)
 * Everything degrades gracefully: while a block is still streaming in (JSON not
 * yet complete) we show a subtle skeleton instead of raw text.
 */

interface CardData {
  title?: string;
  desc?: string;
  highlights?: string[];
  tags?: string[];
  href?: string;
  cta?: string;
  image?: string;
}

interface LinkData {
  label?: string;
  href?: string;
}

/** Flatten react children to plain text (code-block content). */
function nodeText(children: ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(nodeText).join("");
  const maybe = children as unknown as { props?: { children?: ReactNode } };
  if (maybe && typeof maybe === "object" && maybe.props) {
    return nodeText(maybe.props.children);
  }
  return "";
}

function parseLoose<T>(raw: string): T | null {
  const s = raw.trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    /* maybe incomplete / wrapped */
  }
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a !== -1 && b > a) {
    try {
      return JSON.parse(s.slice(a, b + 1)) as T;
    } catch {
      /* still streaming */
    }
  }
  return null;
}

function isHttp(url?: string): url is string {
  return typeof url === "string" && /^https?:\/\//.test(url);
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

function ArrowUpRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

const GROUP_THRESHOLD = 3; // runs longer than this collapse behind "show more"

/**
 * Collapse runs of consecutive `card` fenced blocks into a single `cardgroup`
 * block so the UI can show the first few and hide the rest behind a button.
 * Only applied once a message has finished streaming (so cards don't reflow
 * mid-type). Runs of GROUP_THRESHOLD or fewer cards are left untouched.
 */
function groupCards(md: string): string {
  const runRe = /(?:```card[^\n]*\n[\s\S]*?\n```[ \t]*\n?){2,}/g;
  const cardRe = /```card[^\n]*\n([\s\S]*?)\n```/g;
  return md.replace(runRe, (run) => {
    const cards: string[] = [];
    let m: RegExpExecArray | null;
    cardRe.lastIndex = 0;
    while ((m = cardRe.exec(run))) cards.push(m[1].trim());
    if (cards.length <= GROUP_THRESHOLD) return run;
    return "```cardgroup\n" + JSON.stringify(cards) + "\n```\n";
  });
}

/** The visual card, given already-parsed data. */
function CardView({ d }: { d: CardData }) {
  const tags = Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === "string").slice(0, 4) : [];
  const highlights = Array.isArray(d.highlights)
    ? d.highlights.filter((h) => typeof h === "string" && h.trim()).slice(0, 4)
    : [];
  const href = isHttp(d.href) ? d.href : undefined;
  return (
    <div className="rich-card group">
      {isHttp(d.image) && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={d.image} alt="" className="rich-card__img" loading="lazy" />
      )}
      <div className="rich-card__body">
        <div className="rich-card__head">
          <h3 className="rich-card__title">{d.title}</h3>
          {tags.length > 0 && (
            <div className="rich-chips">
              {tags.map((t) => (
                <span key={t} className="rich-chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        {d.desc && <p className="rich-card__desc">{d.desc}</p>}
        {highlights.length > 0 && (
          <ul className="rich-card__highlights">
            {highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        {href && (
          <a className="rich-cta" href={href} target="_blank" rel="noreferrer noopener">
            {d.cta || `View on ${hostLabel(href)}`}
            <ArrowUpRight />
          </a>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ raw }: { raw: string }) {
  const d = parseLoose<CardData>(raw);
  if (!d || !d.title) {
    return <div className="rich-card rich-card--skeleton" aria-hidden />;
  }
  return <CardView d={d} />;
}

/** A run of project cards, collapsed after the first few behind a "show more"
 *  button so long project lists stay scannable. The JSON payload is an array of
 *  the individual card JSON strings (built in `groupCards`). */
function ProjectCardGroup({ raw, lang }: { raw: string; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const cards = useMemo(() => {
    const arr = parseLoose<string[]>(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => (typeof s === "string" ? parseLoose<CardData>(s) : null))
      .filter((d): d is CardData => !!d && typeof d.title === "string" && d.title.length > 0);
  }, [raw]);

  if (cards.length === 0) return <div className="rich-card rich-card--skeleton" aria-hidden />;

  const VISIBLE = 3;
  const shown = open ? cards : cards.slice(0, VISIBLE);
  const hidden = cards.length - shown.length;
  const moreLabel =
    lang === "es"
      ? `Ver ${hidden} proyecto${hidden === 1 ? "" : "s"} más`
      : `Show ${hidden} more project${hidden === 1 ? "" : "s"}`;

  return (
    <div className="rich-cardgroup">
      {shown.map((d, i) => (
        <CardView key={d.title ?? i} d={d} />
      ))}
      {hidden > 0 && (
        <button type="button" className="rich-more" onClick={() => setOpen(true)}>
          {moreLabel}
          <ChevronDown />
        </button>
      )}
    </div>
  );
}

function LinkButtonBlock({ raw }: { raw: string }) {
  const d = parseLoose<LinkData>(raw);
  if (!d || !isHttp(d.href)) {
    return <div className="rich-linkbtn rich-linkbtn--skeleton" aria-hidden />;
  }
  return (
    <a className="rich-linkbtn" href={d.href} target="_blank" rel="noreferrer noopener">
      <span>{d.label || hostLabel(d.href)}</span>
      <ArrowUpRight />
    </a>
  );
}

function buildComponents(lang: Lang): Components {
  return {
    pre({ children }) {
      const child = Array.isArray(children) ? children[0] : children;
      const props = (child as { props?: { className?: string; children?: ReactNode } })?.props ?? {};
      const cls = props.className ?? "";
      const raw = nodeText(props.children);
      if (cls.includes("language-cardgroup")) return <ProjectCardGroup raw={raw} lang={lang} />;
      if (cls.includes("language-card")) return <ProjectCard raw={raw} />;
      if (cls.includes("language-link")) return <LinkButtonBlock raw={raw} />;
      return <pre className="rich-pre">{children}</pre>;
    },
    code({ className, children }) {
      // Inline code only (block code is handled by `pre` above).
      return <code className={`rich-code ${className ?? ""}`}>{children}</code>;
    },
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className="rich-link">
          {children}
        </a>
      );
    },
    img({ src, alt }) {
      if (!isHttp(typeof src === "string" ? src : undefined)) return null;
      return (
        <span className="rich-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src as string} alt={alt ?? ""} loading="lazy" />
          {alt && <span className="rich-figcaption">{alt}</span>}
        </span>
      );
    },
  };
}

export function RichMarkdown({
  children,
  lang = "en",
  collapse = false,
}: {
  children: string;
  lang?: Lang;
  /** Collapse long card runs behind a "show more" button (only once streaming
   *  has finished, to avoid cards reflowing as they type in). */
  collapse?: boolean;
}) {
  const components = useMemo(() => buildComponents(lang), [lang]);
  const content = useMemo(() => (collapse ? groupCards(children) : children), [children, collapse]);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
