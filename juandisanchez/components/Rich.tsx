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
 *
 * Link safety: the reply now streams live from the model (see app/api/chat),
 * so the server can't post-process the full text before it's shown. Instead,
 * every href/src rendered here is checked against `allowedLinks` — the exact
 * allowlist the model was given (sent by the server via the `X-Links`
 * header). A URL the model invented anyway simply never becomes clickable:
 * markdown/bare links fall back to their label text, images are dropped, and
 * a card's button is omitted (the card itself still renders).
 */

export interface AllowedLink {
  url: string;
  label: string;
}

/** Normalize a URL for allowlist comparison (trailing punctuation/slash). */
function normUrl(raw: string): string {
  return raw.replace(/[.,;:!?)]+$/, "").replace(/\/$/, "");
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Build a lookup from an allowlist array: normalized URL → source label. */
function buildAllowMap(links?: AllowedLink[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const l of links ?? []) map.set(normUrl(l.url), l.label);
  return map;
}

function isAllowedUrl(url: string | undefined, allow: Map<string, string>): boolean {
  return typeof url === "string" && allow.has(normUrl(url));
}

/** A real URL can still be the WRONG project's link on a card — the href must
 *  belong to the card whose title it's attached to (matched via the link's
 *  source label), mirroring the server's own check for the intro path. */
function ownerMatches(url: string, title: string | undefined, allow: Map<string, string>): boolean {
  const label = allow.get(normUrl(url)) ?? "";
  const lab = normName(label);
  const t = normName(title ?? "");
  return Boolean(lab && t && (lab.includes(t) || t.includes(lab)));
}

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

/** The visual card, given already-parsed data. `href`/`image` are only kept
 *  if they're in the allowlist (and, for `href`, actually belong to THIS
 *  card's project) — otherwise the card still renders, just without a button
 *  or image, exactly like the server-side check used to do for the intro. */
function CardView({ d, allow }: { d: CardData; allow: Map<string, string> }) {
  const tags = Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === "string").slice(0, 4) : [];
  const highlights = Array.isArray(d.highlights)
    ? d.highlights.filter((h) => typeof h === "string" && h.trim()).slice(0, 4)
    : [];
  const hrefOk = isHttp(d.href) && isAllowedUrl(d.href, allow) && ownerMatches(d.href, d.title, allow);
  const href = hrefOk ? (d.href as string) : undefined;
  const imageOk = isHttp(d.image) && isAllowedUrl(d.image, allow);
  return (
    <div className="rich-card group">
      {imageOk && (
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

function ProjectCard({ raw, allow }: { raw: string; allow: Map<string, string> }) {
  const d = parseLoose<CardData>(raw);
  if (!d || !d.title) {
    return <div className="rich-card rich-card--skeleton" aria-hidden />;
  }
  return <CardView d={d} allow={allow} />;
}

/** A run of project cards, collapsed after the first few behind a "show more"
 *  button so long project lists stay scannable. The JSON payload is an array of
 *  the individual card JSON strings (built in `groupCards`). */
function ProjectCardGroup({ raw, lang, allow }: { raw: string; lang: Lang; allow: Map<string, string> }) {
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
        <CardView key={d.title ?? i} d={d} allow={allow} />
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

/** Standalone link button. If the href fails the allowlist check it's simply
 *  dropped (no button rendered) rather than shown as a stuck skeleton — the
 *  block is done, it's just not something we'll ever link to. */
function LinkButtonBlock({ raw, allow }: { raw: string; allow: Map<string, string> }) {
  const d = parseLoose<LinkData>(raw);
  if (!d) return <div className="rich-linkbtn rich-linkbtn--skeleton" aria-hidden />;
  if (!isHttp(d.href)) return <div className="rich-linkbtn rich-linkbtn--skeleton" aria-hidden />;
  if (!isAllowedUrl(d.href, allow)) return null;
  return (
    <a className="rich-linkbtn" href={d.href} target="_blank" rel="noreferrer noopener">
      <span>{d.label || hostLabel(d.href)}</span>
      <ArrowUpRight />
    </a>
  );
}

function buildComponents(lang: Lang, allow: Map<string, string>): Components {
  return {
    pre({ children }) {
      const child = Array.isArray(children) ? children[0] : children;
      const props = (child as { props?: { className?: string; children?: ReactNode } })?.props ?? {};
      const cls = props.className ?? "";
      const raw = nodeText(props.children);
      if (cls.includes("language-cardgroup")) return <ProjectCardGroup raw={raw} lang={lang} allow={allow} />;
      if (cls.includes("language-card")) return <ProjectCard raw={raw} allow={allow} />;
      if (cls.includes("language-link")) return <LinkButtonBlock raw={raw} allow={allow} />;
      return <pre className="rich-pre">{children}</pre>;
    },
    code({ className, children }) {
      // Inline code only (block code is handled by `pre` above).
      return <code className={`rich-code ${className ?? ""}`}>{children}</code>;
    },
    a({ href, children }) {
      // Covers both markdown links and GFM-autolinked bare URLs. A URL the
      // model invented (not in the allowlist) falls back to plain text.
      if (!isAllowedUrl(href, allow)) return <>{children}</>;
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className="rich-link">
          {children}
        </a>
      );
    },
    img({ src, alt }) {
      const url = typeof src === "string" ? src : undefined;
      if (!isHttp(url) || !isAllowedUrl(url, allow)) return null;
      return (
        <span className="rich-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={alt ?? ""} loading="lazy" />
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
  allowedLinks,
}: {
  children: string;
  lang?: Lang;
  /** Collapse long card runs behind a "show more" button (only once streaming
   *  has finished, to avoid cards reflowing as they type in). */
  collapse?: boolean;
  /** The exact URL allowlist the model was given for this reply (from the
   *  server's `X-Links` header). Any href/src not in this list never renders
   *  as clickable — see the component overrides above. */
  allowedLinks?: AllowedLink[];
}) {
  const allow = useMemo(() => buildAllowMap(allowedLinks), [allowedLinks]);
  const components = useMemo(() => buildComponents(lang, allow), [lang, allow]);
  const content = useMemo(() => (collapse ? groupCards(children) : children), [children, collapse]);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
