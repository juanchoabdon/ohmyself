"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { RichMarkdown, type AllowedLink } from "@/components/Rich";
import { detectLang, strings, type Lang, type SkillsStrings } from "@/lib/i18n";
import { displayTitle } from "@/lib/noteTitle";

/**
 * Public Skills — the same public notes the Second Self view browses,
 * filtered to `type: "skill"`: Juan Diego's own playbooks (how he works),
 * not just what he's built. No model in the loop; these render verbatim.
 */

interface NoteSummary {
  path: string;
  title: string;
  type: string;
  tags: string[];
  links: string[];
  created?: string;
  updated?: string;
  excerpt?: string;
}

interface NoteFull {
  path: string;
  title: string;
  type: string;
  tags: string[];
  body: string;
  created?: string;
  updated?: string;
}

/** A skill's body is saved as `> when to use it\n\n<instructions>` — pull the
 *  blockquote out as the card blurb instead of showing raw markdown syntax. */
function whenToUse(text?: string): string {
  if (!text) return "";
  const line = text
    .split("\n")
    .find((l) => l.trim().startsWith(">"));
  const raw = line ? line.replace(/^>\s*/, "") : text;
  return raw.trim();
}

function extractUrls(body: string): string[] {
  const out = new Set<string>();
  const re = /https?:\/\/[^\s)\]}"'<>]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.add(m[0].replace(/[.,;:!?]+$/, ""));
  return [...out];
}

export default function SkillsPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [langReady, setLangReady] = useState(false);
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openSkill, setOpenSkill] = useState<NoteFull | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState(false);

  const t = strings(lang);

  useEffect(() => {
    let chosen: Lang;
    try {
      const saved = localStorage.getItem("jds.lang");
      chosen = saved === "es" || saved === "en" ? saved : detectLang();
    } catch {
      chosen = detectLang();
    }
    setLang(chosen);
    if (typeof document !== "undefined") document.documentElement.lang = chosen;
    setLangReady(true);
  }, []);

  // Skills are written verbatim in whatever language JD wrote them in —
  // titles/blurbs are translated server-side to match the visitor's
  // language (cached — see lib/translate.ts), so this refetches whenever
  // `lang` changes, not just once on mount.
  useEffect(() => {
    if (!langReady) return;
    let alive = true;
    fetch(`/api/brain/notes?lang=${lang}`)
      .then((r) => r.json())
      .then((d: { notes?: NoteSummary[] }) => {
        if (alive) setNotes((d.notes ?? []).filter((n) => n.type === "skill"));
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [lang, langReady]);

  function onLang(next: Lang) {
    setLang(next);
    if (typeof document !== "undefined") document.documentElement.lang = next;
    try {
      localStorage.setItem("jds.lang", next);
    } catch {
      /* storage unavailable — fine, just won't persist */
    }
  }

  const openSkillByPath = useCallback(
    (path: string) => {
      setOpenPath(path);
      setOpenSkill(null);
      setOpenError(false);
      setOpenLoading(true);
      fetch(`/api/brain/note?path=${encodeURIComponent(path)}&lang=${lang}`)
        .then((r) => r.json())
        .then((d: { note?: NoteFull }) => {
          if (d.note) setOpenSkill(d.note);
          else setOpenError(true);
        })
        .catch(() => setOpenError(true))
        .finally(() => setOpenLoading(false));
    },
    [lang],
  );

  // Re-translate the skill currently open in the drawer whenever the
  // visitor switches language.
  useEffect(() => {
    if (!langReady || !openPath) return;
    openSkillByPath(openPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const filtered = useMemo(() => {
    if (!notes) return [];
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.tags.some((tg) => tg.toLowerCase().includes(q)) ||
        whenToUse(n.excerpt).toLowerCase().includes(q),
    );
  }, [notes, query]);

  const skillLinks: AllowedLink[] = useMemo(
    () => (openSkill ? extractUrls(openSkill.body).map((url) => ({ url, label: openSkill.title })) : []),
    [openSkill],
  );

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-5xl flex-col px-5 sm:px-8">
      <SiteHeader lang={lang} onLang={onLang} active="skills" />

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">{t.skills.title}</h2>
          <p className="text-sm text-muted">{t.skills.subtitle}</p>
        </div>
        {notes && <span className="hidden text-xs text-faint sm:inline">{t.skills.skillsCount(notes.length)}</span>}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden pb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.skills.searchPlaceholder}
          className="mb-3 w-full shrink-0 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none"
          aria-label={t.skills.searchPlaceholder}
        />
        <div className="-mr-3 flex-1 overflow-y-auto pr-3 sm:-mr-5 sm:pr-5" style={{ scrollbarGutter: "stable" }}>
          {!notes && !loadError && <p className="px-1 text-sm text-muted">{t.skills.loading}</p>}
          {loadError && <p className="px-1 text-sm text-muted">{t.skills.loadError}</p>}
          {notes && notes.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <p className="font-heading text-base font-semibold">{t.skills.emptyTitle}</p>
              <p className="mt-1 text-sm text-muted">{t.skills.emptySub}</p>
            </div>
          )}
          <div className="skills-grid pb-2">
            {filtered.map((n) => (
              <SkillCard key={n.path} note={n} whenLabel={t.skills.whenToUse} onOpen={() => openSkillByPath(n.path)} />
            ))}
          </div>
        </div>
      </div>

      {openPath && (
        <SkillDrawer
          skill={openSkill}
          loading={openLoading}
          error={openError}
          lang={lang}
          links={skillLinks}
          onClose={() => setOpenPath(null)}
          t={t.skills}
        />
      )}
    </main>
  );
}

function SkillCard({
  note,
  whenLabel,
  onOpen,
}: {
  note: NoteSummary;
  whenLabel: string;
  onOpen: () => void;
}) {
  const blurb = whenToUse(note.excerpt);
  return (
    <button type="button" onClick={onOpen} className="skill-card group text-left">
      <div className="skill-card__head">
        <span className="skill-card__icon" aria-hidden>
          <SkillIcon />
        </span>
        <h3 className="skill-card__title">{displayTitle(note.title, note.path)}</h3>
      </div>
      {blurb && (
        <p className="skill-card__blurb">
          <span className="skill-card__blurb-label">{whenLabel}: </span>
          {blurb}
        </p>
      )}
      {note.tags.length > 0 && (
        <div className="rich-chips mt-3">
          {note.tags.slice(0, 4).map((tg) => (
            <span key={tg} className="rich-chip">
              {tg}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function SkillDrawer({
  skill,
  loading,
  error,
  lang,
  links,
  onClose,
  t,
}: {
  skill: NoteFull | null;
  loading: boolean;
  error: boolean;
  lang: Lang;
  links: AllowedLink[];
  onClose: () => void;
  t: SkillsStrings;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex h-full w-full max-w-lg flex-col border-l border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-heading text-base font-semibold text-ink">
              {skill ? displayTitle(skill.title, skill.path) : "…"}
            </p>
            {skill?.updated && <p className="text-xs text-faint">{skill.updated}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ scrollbarGutter: "stable" }}>
          {loading && <p className="text-sm text-muted">{t.loading}</p>}
          {!loading && error && <p className="text-sm text-muted">{t.loadError}</p>}
          {!loading && skill && (
            <div className="prose">
              <RichMarkdown lang={lang} allowedLinks={links}>
                {skill.body}
              </RichMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2 3 7l9 5 9-5-9-5Z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}
