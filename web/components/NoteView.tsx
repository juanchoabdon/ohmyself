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
import { MarkdownEditor, EditorBodySkeleton, type ScrollToHeadingTarget } from "./editor/MarkdownEditor";
import { EditorModeToggle, loadEditorModePreference } from "./editor/EditorModeToggle";
import type { PresencePeer } from "./editor/PresenceBar";
import type { CollabUser } from "@/lib/collabUser";
import { isWikiHref, wikiLinksToMarkdownLinks, wikiPathFromHref } from "./editor/wikiLinkMarkdown";
import { dedupeExactDoubleBody, stripRedundantTitleH1 } from "@/lib/dedupeBody";
import { cn } from "@/lib/utils";
import { ShareNoteButton } from "./ShareNoteButton";

/** Pause after last keystroke before autosave — tuned to feel like Docs/OK. */
const AUTOSAVE_MS = 400;

type SaveStatus = "idle" | "saving" | "error";

export type NoteViewHandle = {
  /** Flush any pending debounced save (e.g. before switching notes). */
  flush: () => Promise<void>;
};

type NoteViewProps = {
  note: FullNote | null;
  loading: boolean;
  /** Path currently being fetched (may differ from `note.path` while switching). */
  activePath?: string | null;
  /** Sidebar/index title shown in the loading shell. */
  previewTitle?: string | null;
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
  collabUser?: CollabUser | null;
  agentPresence?: PresencePeer[];
  onSelectPresencePeer?: (peer: PresencePeer) => void;
  /** Canonical share URL for this note (deep link with space). */
  shareUrl?: string | null;
};

export const NoteView = forwardRef<NoteViewHandle, NoteViewProps>(function NoteView(
  {
    note,
    loading,
    activePath,
    previewTitle,
    onOpenLink,
    onSave,
    onDelete,
    onBodyChange,
    onDirtyChange,
    scrollToHeading,
    collab,
    collabUser,
    agentPresence,
    onSelectPresencePeer,
    shareUrl,
  },
  ref,
) {
  const editable = Boolean(onSave);
  /** Yjs owns the body: the collab server persists it (onStoreDocument), so
   *  REST autosave must not PATCH body — only title/tags/visibility. */
  const collabActive = Boolean(collab?.enabled && collab.token && collab.spaceId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [tags, setTags] = useState("");
  const [editorLive, setEditorLive] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const titleRefVal = useRef("");
  const bodyRefVal = useRef("");
  const visibilityRefVal = useRef<Visibility>("private");
  const tagsRefVal = useRef("");
  /** Last successfully persisted snapshot — avoids collab/Yjs markdown drift re-triggering autosave. */
  const lastPersistedRef = useRef({
    title: "",
    body: "",
    visibility: "private" as Visibility,
    tags: "",
  });

  titleRefVal.current = title;
  bodyRefVal.current = body;
  visibilityRefVal.current = visibility;
  tagsRefVal.current = tags;

  useLayoutEffect(() => {
    setEditorLive(false);
    setError(null);
    setSaveStatus("idle");
    if (note) {
      setTitle(note.meta.title);
      setBody(note.body);
      setVisibility(note.meta.visibility);
      setTags(note.meta.tags.join(", "));
      lastPersistedRef.current = {
        title: note.meta.title,
        body: note.body,
        visibility: note.meta.visibility,
        tags: note.meta.tags.join(", "),
      };
    }
  }, [note?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    Boolean(note) &&
    editable &&
    (title.trim() !== lastPersistedRef.current.title ||
      (!collabActive && body !== lastPersistedRef.current.body) ||
      visibility !== lastPersistedRef.current.visibility ||
      tags !== lastPersistedRef.current.tags);

  dirtyRef.current = dirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const persist = useCallback(async () => {
    if (!onSave || !note || savingRef.current || !titleRefVal.current.trim()) return;
    savingRef.current = true;
    clearTimeout(saveTimerRef.current);
    setError(null);
    const patch = {
      title: titleRefVal.current.trim(),
      // In collab mode the Hocuspocus server persists the body from the Y doc;
      // PATCHing it here would race that single writer.
      ...(collabActive ? {} : { body: bodyRefVal.current }),
      visibility: visibilityRefVal.current,
      tags: tagsRefVal.current.split(",").map((t) => t.trim()).filter(Boolean),
    };
    try {
      const saved = await onSave(patch);
      if (saved) {
        setTitle(saved.meta.title);
        // In collab mode the vault body may lag the live Y doc — don't pull it
        // back over the editor state.
        if (!collabActive) setBody(saved.body);
        setVisibility(saved.meta.visibility);
        setTags(saved.meta.tags.join(", "));
        lastPersistedRef.current = {
          title: saved.meta.title,
          body: collabActive ? bodyRefVal.current : saved.body,
          visibility: saved.meta.visibility,
          tags: saved.meta.tags.join(", "),
        };
      }
      setSaveStatus("idle");
      setError(null);
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
  }, [onSave, note, collabActive]);

  const scheduleSave = useCallback(() => {
    if (!dirtyRef.current || !onSave || !titleRefVal.current.trim()) return;
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
    },
    [],
  );

  const pendingNote =
    Boolean(activePath) && (!note || note.path !== activePath);
  const fetching = pendingNote || (Boolean(activePath) && loading);
  const ready = Boolean(note && note.path === activePath && !fetching);
  /** One stable title control — preview while fetching, then editable state (no h1↔textarea swap). */
  const titleDisplay = fetching ? (previewTitle ?? title) : title;
  const titleClassName =
    "oms-inline-edit w-full resize-none overflow-hidden bg-transparent text-[1.7rem] font-bold leading-tight tracking-tight text-ink outline-none placeholder:text-muted/50";
  const noteTitle = note?.meta.title ?? "";
  const vaultBody = stripRedundantTitleH1(note?.body ?? "", noteTitle);
  const editorBody = stripRedundantTitleH1(body, noteTitle);
  const hasEditorBody = Boolean(editorBody.trim());
  const hasVaultBody = Boolean(vaultBody.trim());

  if (!activePath && !ready && !fetching) {
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

  return (
    <article
      className="mx-auto w-full max-w-3xl px-8 py-10"
      aria-busy={fetching || !editorLive}
    >
      <header className="mb-6 border-b border-border pb-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            {fetching ? (
              <>
                <span className="skeleton h-5 w-16 rounded-full" />
                <span className="skeleton h-5 w-20 rounded-full" />
              </>
            ) : (
              <>
                <span className="rounded bg-bg px-1.5 py-0.5 font-medium capitalize">{note!.meta.type}</span>
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
                  <VisibilityBadge visibility={note!.meta.visibility} />
                )}
                {saveStatus === "error" && editable && (
                  <span className="text-vis-secret">· Save failed</span>
                )}
                {!editable && note!.meta.updated && (
                  <span>· updated {note!.meta.updated}</span>
                )}
              </>
            )}
          </div>
          {note && (onDelete || shareUrl) && (
            <div className="flex shrink-0 items-center gap-1.5">
              {shareUrl ? <ShareNoteButton url={shareUrl} /> : null}
              {onDelete ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await onDelete();
                    } catch {
                      /* parent handles */
                    }
                  }}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-vis-secret hover:border-vis-secret"
                >
                  Delete
                </button>
              ) : null}
            </div>
          )}
        </div>

        {editable ? (
          <>
            <AutoTextarea
              ref={titleRef}
              value={titleDisplay}
              readOnly={fetching}
              onChange={(e) => {
                if (fetching) return;
                setTitle(e.target.value);
              }}
              onBlur={() => void flush()}
              placeholder="Title"
              spellCheck={false}
              aria-busy={fetching}
              className={cn(titleClassName, fetching && "cursor-default")}
            />
            <input
              value={fetching ? "" : tags}
              readOnly={fetching}
              onChange={(e) => setTags(e.target.value)}
              onBlur={() => void flush()}
              placeholder="tags, comma, separated"
              tabIndex={fetching ? -1 : 0}
              aria-hidden={fetching}
              className={cn(
                "oms-inline-edit mt-3 w-full bg-transparent text-xs text-muted outline-none placeholder:text-muted/50",
                fetching && "invisible",
              )}
            />
          </>
        ) : ready ? (
          <>
            <h1 className="text-[1.7rem] font-bold tracking-tight text-balance">{note!.meta.title}</h1>
            {note!.meta.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {note!.meta.tags.map((t) => (
                  <span key={t} className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <AutoTextarea
              value={previewTitle ?? ""}
              readOnly
              placeholder="Title"
              aria-busy
              className={cn(titleClassName, "cursor-default")}
            />
            <div className="mt-3 h-4" aria-hidden />
          </>
        )}
      </header>

      <div className="relative min-h-[8rem]">
        {fetching ? (
          <>
            {/* Reserve the toggle row so the body doesn't jump when the editor mounts. */}
            {editable && <ModeTogglePlaceholder />}
            <EditorBodySkeleton />
          </>
        ) : ready && editable ? (
          <div className="relative min-h-[8rem]">
            {/* Show the vault markdown until the live editor is ready, so the body
                is never blank (Yjs can take a moment to sync). The placeholder
                toggle keeps the layout identical to the live editor's chrome. */}
            {!editorLive && (
              <>
                <ModeTogglePlaceholder />
                {hasVaultBody || hasEditorBody ? (
                  <div className="prose min-h-[8rem]">
                    <ReadOnlyBody body={editorBody || vaultBody} onOpenLink={onOpenLink} />
                  </div>
                ) : (
                  <EditorBodySkeleton />
                )}
              </>
            )}
            <div
              className={
                editorLive
                  ? "relative min-h-[8rem]"
                  : "pointer-events-none absolute inset-x-0 top-0 opacity-0"
              }
              aria-hidden={!editorLive}
            >
              <MarkdownEditor
                key={note!.path}
                noteKey={note!.path}
                value={editorBody || vaultBody}
                onChange={(md) => {
                  // Yjs sync can transiently empty the doc before the seed lands.
                  // Never let that propagate into state/autosave and wipe the vault.
                  if (!md.trim() && !editorLive) return;
                  const { body: cleaned } = dedupeExactDoubleBody(md);
                  setBody(cleaned);
                  onBodyChange?.(cleaned);
                }}
                onBlur={() => void flush()}
                onOpenLink={onOpenLink}
                scrollToHeading={scrollToHeading}
                onReady={() => setEditorLive(true)}
                collab={
                  collab?.enabled && collab.token && collab.spaceId
                    ? {
                        token: collab.token,
                        spaceId: collab.spaceId,
                        path: note!.path,
                        initialBody: stripRedundantTitleH1(note!.body, noteTitle),
                      }
                    : null
                }
                collabUser={collabUser}
                agentPresence={agentPresence}
                onSelectPresencePeer={onSelectPresencePeer}
              />
            </div>
          </div>
        ) : ready && !editable ? (
          <div className="prose min-h-[8rem]">
            {note!.body.trim() ? (
              <ReadOnlyBody body={note!.body} onOpenLink={onOpenLink} />
            ) : (
              <p className="text-muted/70">Empty.</p>
            )}
          </div>
        ) : null}
      </div>

      {error && <p className="mt-3 rounded-md bg-vis-secret/10 px-3 py-2 text-sm text-vis-secret">{error}</p>}

      <footer
        className={cn(
          "mt-8 border-t border-border pt-4",
          ready && note!.meta.links.length > 0 ? "block" : "hidden",
        )}
      >
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Linked</h3>
        <div className="flex flex-wrap gap-2">
          {ready &&
            note!.meta.links.map((l) => (
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
    </article>
  );
});

/** Disabled Visual/Source toggle occupying the exact space of the live one, so
 *  the body never shifts down when the editor chrome mounts. */
function ModeTogglePlaceholder() {
  return (
    <div aria-hidden className="pointer-events-none select-none opacity-60">
      <EditorModeToggle mode={loadEditorModePreference()} onChange={() => {}} disabled />
    </div>
  );
}

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
