"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FullNote, Visibility } from "@/lib/types";
import { VisibilityBadge } from "./VisibilityBadge";

export function NoteView({
  note,
  loading,
  onOpenLink,
  onSave,
  onDelete,
}: {
  note: FullNote | null;
  loading: boolean;
  onOpenLink: (path: string) => void;
  onSave?: (patch: { title?: string; body?: string; visibility?: Visibility; tags?: string[] }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const editable = Boolean(onSave);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusTarget = useRef<"title" | "body" | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Sync local fields whenever a different note opens; leave edit mode.
  useEffect(() => {
    setEditing(false);
    setError(null);
    if (note) {
      setTitle(note.meta.title);
      setBody(note.body);
      setVisibility(note.meta.visibility);
      setTags(note.meta.tags.join(", "));
    }
  }, [note?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the field the user clicked once the editors mount.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = focusTarget.current === "title" ? titleRef.current : bodyRef.current;
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
    focusTarget.current = null;
  }, [editing]);

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

  const dirty =
    editing &&
    (title.trim() !== note.meta.title ||
      body !== note.body ||
      visibility !== note.meta.visibility ||
      tags !== note.meta.tags.join(", "));

  function start(target: "title" | "body") {
    if (!editable || busy) return;
    focusTarget.current = target;
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
    setTitle(note!.meta.title);
    setBody(note!.body);
    setVisibility(note!.meta.visibility);
    setTags(note!.meta.tags.join(", "));
  }

  async function save() {
    if (!onSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        body,
        visibility,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-8 py-10">
      {/* Slim action bar — only while editing */}
      {editing && (
        <div className="sticky top-0 z-10 -mx-8 mb-5 flex items-center justify-between border-b border-border bg-bg/85 px-8 py-2.5 backdrop-blur">
          <span className="text-xs font-medium text-muted">{dirty ? "Unsaved changes" : "Editing"}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={cancel}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:text-ink disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || !title.trim() || !dirty}
              className="rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <header className="mb-6 border-b border-border pb-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="rounded bg-bg px-1.5 py-0.5 font-medium capitalize">{note.meta.type}</span>
            {editing ? (
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
            {!editing && note.meta.updated && <span>· updated {note.meta.updated}</span>}
          </div>
          {!editing && (onSave || onDelete) && (
            <div className="flex items-center gap-1.5">
              {onSave && (
                <button
                  onClick={() => start("body")}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink hover:border-brand hover:text-brand-ink"
                >
                  Edit
                </button>
              )}
              {onDelete && (
                <button
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onDelete();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-vis-secret hover:border-vis-secret disabled:opacity-60"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>

        {editing ? (
          <AutoTextarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            spellCheck={false}
            className="w-full resize-none overflow-hidden bg-transparent text-[1.7rem] font-bold leading-tight tracking-tight text-ink outline-none placeholder:text-muted/50"
          />
        ) : (
          <h1
            onClick={() => start("title")}
            className={`text-[1.7rem] font-bold tracking-tight text-balance ${
              editable ? "cursor-text rounded transition-colors hover:bg-surface" : ""
            }`}
            title={editable ? "Click to edit" : undefined}
          >
            {note.meta.title}
          </h1>
        )}

        {editing ? (
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="tags, comma, separated"
            className="mt-3 w-full bg-transparent text-xs text-muted outline-none placeholder:text-muted/50"
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

      {editing ? (
        <AutoTextarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write in markdown… click anywhere to keep typing."
          className="w-full resize-none overflow-hidden bg-transparent text-[0.98rem] leading-7 text-ink outline-none placeholder:text-muted/50"
        />
      ) : (
        <div
          onClick={() => start("body")}
          className={`prose min-h-[8rem] ${editable ? "cursor-text" : ""}`}
          title={editable ? "Click to edit" : undefined}
        >
          {note.body.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown>
          ) : (
            <p className="text-muted/70">{editable ? "Empty — click to write something." : "Empty."}</p>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-md bg-vis-secret/10 px-3 py-2 text-sm text-vis-secret">{error}</p>}

      {!editing && note.meta.links.length > 0 && (
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
}

/** A borderless textarea that grows to fit its content, so editing feels inline
 *  with the page rather than inside a fixed box. */
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
