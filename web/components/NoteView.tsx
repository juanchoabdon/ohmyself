"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FullNote, Visibility } from "@/lib/types";
import { VisibilityBadge } from "./VisibilityBadge";
import { MarkdownEditor, type ScrollToHeadingTarget } from "./editor/MarkdownEditor";
import { isWikiHref, wikiLinksToMarkdownLinks, wikiPathFromHref } from "./editor/wikiLinkMarkdown";

/** Pause after last keystroke before autosave — tuned to feel like Docs/OK. */
const AUTOSAVE_MS = 400;
const SAVED_FLASH_MS = 1500;

type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export type NoteViewHandle = {
  /** Flush any pending debounced save (e.g. before switching notes). */
  flush: () => Promise<void>;
};

type NoteViewProps = {
  note: FullNote | null;
  loading: boolean;
  onOpenLink: (path: string) => void;
  onSave?: (patch: {
    title?: string;
    body?: string;
    visibility?: Visibility;
    tags?: string[];
  }) => Promise<FullNote | void>;
  onDelete?: () => Promise<void>;
  onBodyChange?: (body: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  scrollToHeading?: ScrollToHeadingTarget | null;
  /** When set, enables Yjs co-editing for the note body (REST autosave still applies). */
  collab?: {
    enabled: boolean;
    token: string;
    spaceId: string;
  } | null;
};

export const NoteView = forwardRef<NoteViewHandle, NoteViewProps>(function NoteView(
  {
    note,
    loading,
    onOpenLink,
    onSave,
    onDelete,
    onBodyChange,
    onDirtyChange,
    scrollToHeading,
    collab,
  },
  ref,
) {
  const editable = Boolean(onSave);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [tags, setTags] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedFlashRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const titleRefVal = useRef("");
  const bodyRefVal = useRef("");
  const visibilityRefVal = useRef<Visibility>("private");
  const tagsRefVal = useRef("");

  titleRefVal.current = title;
  bodyRefVal.current = body;
  visibilityRefVal.current = visibility;
  tagsRefVal.current = tags;

  useEffect(() => {
    setError(null);
    setSaveStatus("idle");
    if (note) {
      setTitle(note.meta.title);
      setBody(note.body);
      setVisibility(note.meta.visibility);
      setTags(note.meta.tags.join(", "));
    }
  }, [note?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    Boolean(note) &&
    editable &&
    (title.trim() !== note!.meta.title ||
      body !== note!.body ||
      visibility !== note!.meta.visibility ||
      tags !== note!.meta.tags.join(", "));

  dirtyRef.current = dirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const persist = useCallback(async () => {
    if (!onSave || !note || savingRef.current || !titleRefVal.current.trim()) return;
    savingRef.current = true;
    clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    setError(null);
    const patch = {
      title: titleRefVal.current.trim(),
      body: bodyRefVal.current,
      visibility: visibilityRefVal.current,
      tags: tagsRefVal.current.split(",").map((t) => t.trim()).filter(Boolean),
    };
    try {
      const saved = await onSave(patch);
      if (saved) {
        setTitle(saved.meta.title);
        setBody(saved.body);
        setVisibility(saved.meta.visibility);
        setTags(saved.meta.tags.join(", "));
      }
      setSaveStatus("saved");
      clearTimeout(savedFlashRef.current);
      savedFlashRef.current = setTimeout(() => setSaveStatus("idle"), SAVED_FLASH_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSaveStatus("error");
    } finally {
      savingRef.current = false;
      // User kept typing during the round-trip — save again without waiting full debounce.
      if (dirtyRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => void persist(), 150);
      }
    }
  }, [onSave, note]);

  const scheduleSave = useCallback(() => {
    if (!dirtyRef.current || !onSave || !titleRefVal.current.trim()) return;
    setSaveStatus("pending");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void persist(), AUTOSAVE_MS);
  }, [onSave, persist]);

  const flush = useCallback(async () => {
    clearTimeout(saveTimerRef.current);
    if (dirtyRef.current && titleRefVal.current.trim()) await persist();
  }, [persist]);

  useImperativeHandle(ref, () => ({ flush }), [flush]);

  // Debounced autosave on every edit.
  useEffect(() => {
    if (!dirty || !onSave || !title.trim()) return;
    scheduleSave();
    return () => clearTimeout(saveTimerRef.current);
  }, [dirty, onSave, title, body, visibility, tags, scheduleSave]);

  useEffect(() => {
    if (!dirty) setSaveStatus((s) => (s === "pending" ? "idle" : s));
  }, [dirty]);

  // ⌘S / Ctrl+S flushes immediately.
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, flush]);

  // Flush when leaving the tab or closing the window.
  useEffect(() => {
    if (!editable) return;
    const onHide = () => void flush();
    const onVis = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [editable, flush]);

  useEffect(
    () => () => {
      clearTimeout(saveTimerRef.current);
      clearTimeout(savedFlashRef.current);
    },
    [],
  );

  if (loading) return <Centered>Loading…</Centered>;
  if (!note) {
    return (
      <Centered>
        <div className="max-w-sm text-center">
          <h2 className="text-lg font-semibold text-ink">Pick an entry</h2>
          <p className="mt-1 text-sm text-muted">
            Choose something from your second self on the left, or create a new entry.
          </p>
        </div>
      </Centered>
    );
  }

  function revert() {
    setError(null);
    setSaveStatus("idle");
    clearTimeout(saveTimerRef.current);
    setTitle(note!.meta.title);
    setBody(note!.body);
    setVisibility(note!.meta.visibility);
    setTags(note!.meta.tags.join(", "));
  }

  const statusLabel =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "pending"
          ? "Unsaved"
          : saveStatus === "error"
            ? "Save failed"
            : "Editing";

  return (
    <article className="mx-auto w-full max-w-3xl px-8 py-10">
      <header className="mb-6 border-b border-border pb-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="rounded bg-bg px-1.5 py-0.5 font-medium capitalize">{note.meta.type}</span>
            {editable ? (
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as Visibility)}
                className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-ink focus:border-brand"
              >
                <option value="public">public</option>
                <option value="private">private</option>
                <option value="secret">secret</option>
              </select>
            ) : (
              <VisibilityBadge visibility={note.meta.visibility} />
            )}
            {editable ? (
              <span
                className={
                  saveStatus === "saved"
                    ? "text-vis-public"
                    : saveStatus === "error"
                      ? "text-vis-secret"
                      : undefined
                }
              >
                · {statusLabel}
              </span>
            ) : (
              note.meta.updated && <span>· updated {note.meta.updated}</span>
            )}
          </div>
          {(onSave || onDelete) && (
            <div className="flex items-center gap-1.5">
              {editable && dirty && (
                <button
                  onClick={revert}
                  disabled={saveStatus === "saving"}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted hover:text-ink disabled:opacity-60"
                >
                  Revert
                </button>
              )}
              {onDelete && (
                <button
                  onClick={async () => {
                    try {
                      await onDelete();
                    } catch {
                      /* parent handles */
                    }
                  }}
                  disabled={saveStatus === "saving"}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-vis-secret hover:border-vis-secret disabled:opacity-60"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>

        {editable ? (
          <AutoTextarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void flush()}
            placeholder="Title"
            spellCheck={false}
            className="oms-inline-edit w-full resize-none overflow-hidden bg-transparent text-[1.7rem] font-bold leading-tight tracking-tight text-ink outline-none placeholder:text-muted/50"
          />
        ) : (
          <h1 className="text-[1.7rem] font-bold tracking-tight text-balance">{note.meta.title}</h1>
        )}

        {editable ? (
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => void flush()}
            placeholder="tags, comma, separated"
            className="oms-inline-edit mt-3 w-full bg-transparent text-xs text-muted outline-none placeholder:text-muted/50"
          />
        ) : (
          note.meta.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {note.meta.tags.map((t) => (
                <span key={t} className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted">
                  #{t}
                </span>
              ))}
            </div>
          )
        )}
      </header>

      {editable ? (
        <MarkdownEditor
          key={note.path}
          noteKey={note.path}
          value={body}
          onChange={(md) => {
            setBody(md);
            onBodyChange?.(md);
          }}
          onBlur={() => void flush()}
          onOpenLink={onOpenLink}
          scrollToHeading={scrollToHeading}
          collab={
            collab?.enabled && collab.token && collab.spaceId
              ? {
                  token: collab.token,
                  spaceId: collab.spaceId,
                  path: note.path,
                  initialBody: note.body,
                }
              : null
          }
        />
      ) : (
        <div className="prose min-h-[8rem]">
          {note.body.trim() ? (
            <ReadOnlyBody body={note.body} onOpenLink={onOpenLink} />
          ) : (
            <p className="text-muted/70">Empty.</p>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-md bg-vis-secret/10 px-3 py-2 text-sm text-vis-secret">{error}</p>}

      {note.meta.links.length > 0 && (
        <footer className="mt-8 border-t border-border pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Linked</h3>
          <div className="flex flex-wrap gap-2">
            {note.meta.links.map((l) => (
              <button
                key={l}
                onClick={() => onOpenLink(l)}
                className="rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-brand hover:bg-brand-weak"
              >
                {l}
              </button>
            ))}
          </div>
        </footer>
      )}
    </article>
  );
});

function ReadOnlyBody({ body, onOpenLink }: { body: string; onOpenLink: (path: string) => void }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (isWikiHref(href)) {
            return (
              <button
                type="button"
                onClick={() => onOpenLink(wikiPathFromHref(href!))}
                className="oms-wiki-link font-medium text-brand underline underline-offset-2"
              >
                {children}
              </button>
            );
          }
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {wikiLinksToMarkdownLinks(body)}
    </ReactMarkdown>
  );
}

const AutoTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoTextarea(props, ref) {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);
    const fit = () => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    useLayoutEffect(fit, [props.value]);
    return <textarea ref={innerRef} rows={1} {...props} onInput={fit} />;
  },
);

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center text-muted">{children}</div>;
}
