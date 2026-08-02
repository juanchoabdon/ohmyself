"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, MessageSquare, Trash2, Undo2, X } from "lucide-react";
import type { CommentThread, NoteComment } from "@/lib/types";
import type { CommentsController } from "@/lib/useComments";
import { cn } from "@/lib/utils";

/** A selection waiting to become a thread (started from the editor). */
export type CommentDraft = { quote: string; offset?: number } | null;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || "?";
}

function CommentBubble({
  comment,
  canManage,
  onDelete,
}: {
  comment: NoteComment;
  canManage: boolean;
  onDelete: () => void;
}) {
  const agent = comment.author.kind === "agent";
  return (
    <li className="group flex gap-2">
      <span
        className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white",
          agent ? "bg-ink/70" : "bg-brand",
        )}
        aria-hidden
      >
        {agent ? <Bot className="h-3 w-3" /> : initials(comment.author.label)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[11px] font-semibold text-ink">{comment.author.label}</span>
          <span className="shrink-0 text-[10px] text-muted/80">{formatWhen(comment.createdAt)}</span>
          {canManage && (
            <button
              type="button"
              onClick={onDelete}
              className="ml-auto shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
              aria-label="Delete comment"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-ink/90">
          {comment.body}
        </p>
      </div>
    </li>
  );
}

function Composer({
  placeholder,
  autoFocus,
  onSubmit,
  onCancel,
  submitLabel = "Comment",
}: {
  placeholder: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  async function submit() {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape" && onCancel) onCancel();
        }}
        rows={2}
        placeholder={placeholder}
        className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-ink outline-none placeholder:text-muted/70 focus:border-brand/50"
      />
      <div className="mt-1 flex items-center justify-end gap-1.5">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-1 text-[11px] text-muted hover:text-ink"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!value.trim() || busy}
          className="rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
        >
          {busy ? "Sending…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

function ThreadCard({
  thread,
  active,
  currentUserId,
  onFocus,
  onReply,
  onResolve,
  onDelete,
}: {
  thread: CommentThread;
  active: boolean;
  currentUserId: string | null;
  onFocus: () => void;
  onReply: (body: string) => Promise<void>;
  onResolve: (resolved: boolean) => void;
  onDelete: (commentId: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const resolved = Boolean(thread.resolvedAt);
  const comments = [thread.root, ...thread.replies];

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onFocus}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onFocus();
        }}
        className={cn(
          "cursor-pointer rounded-lg border px-2.5 py-2 transition-colors",
          active ? "border-brand/40 bg-brand-weak/40" : "border-border/80 bg-bg/40 hover:border-brand/25",
          resolved && "opacity-60",
        )}
      >
        {thread.anchor && (
          <p
            className={cn(
              "mb-1.5 border-l-2 pl-2 text-[11px] italic leading-snug",
              thread.orphaned ? "border-border text-muted line-through" : "border-brand/50 text-muted",
            )}
          >
            {thread.anchor.quote.length > 120
              ? `${thread.anchor.quote.slice(0, 120)}…`
              : thread.anchor.quote}
          </p>
        )}
        {thread.orphaned && (
          <p className="mb-1.5 text-[10px] text-muted">This text is no longer in the note</p>
        )}

        <ul className="space-y-2">
          {comments.map((c) => (
            <CommentBubble
              key={c.id}
              comment={c}
              canManage={Boolean(currentUserId) && c.author.userId === currentUserId}
              onDelete={() => onDelete(c.id)}
            />
          ))}
        </ul>

        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setReplying((v) => !v);
            }}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-bg hover:text-ink"
          >
            Reply
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onResolve(!resolved);
            }}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-bg hover:text-ink"
          >
            {resolved ? <Undo2 className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            {resolved ? "Reopen" : "Resolve"}
          </button>
        </div>

        {replying && (
          <div onClick={(e) => e.stopPropagation()}>
            <Composer
              placeholder="Reply…"
              autoFocus
              submitLabel="Reply"
              onCancel={() => setReplying(false)}
              onSubmit={async (body) => {
                await onReply(body);
                setReplying(false);
              }}
            />
          </div>
        )}
      </div>
    </li>
  );
}

export function CommentsPanel({
  open,
  onClose,
  comments,
  draft,
  onDraftChange,
  activeThreadId,
  onFocusThread,
  currentUserId,
  canComment,
}: {
  open: boolean;
  onClose: () => void;
  comments: CommentsController;
  /** Text selected in the editor, waiting for a first comment. */
  draft: CommentDraft;
  onDraftChange: (draft: CommentDraft) => void;
  activeThreadId: string | null;
  onFocusThread: (threadId: string | null) => void;
  currentUserId: string | null;
  canComment: boolean;
}) {
  const { threads, loading, error, showResolved, setShowResolved } = comments;

  const { open: openThreads, resolved: resolvedThreads } = useMemo(() => {
    const openList: CommentThread[] = [];
    const resolvedList: CommentThread[] = [];
    for (const t of threads) (t.resolvedAt ? resolvedList : openList).push(t);
    return { open: openList, resolved: resolvedList };
  }, [threads]);

  if (!open) return null;

  return (
    <aside className="flex min-h-0 w-80 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted" />
          Comments
          {openThreads.length > 0 && (
            <span className="rounded-full bg-brand-weak px-1.5 text-[10px] font-semibold text-brand-ink">
              {openThreads.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-bg hover:text-ink"
          aria-label="Close comments"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && <p className="mb-2 px-1 text-[11px] text-red-500">{error}</p>}

        {draft && (
          <div className="mb-3 rounded-lg border border-brand/40 bg-brand-weak/30 px-2.5 py-2">
            <p className="mb-1 border-l-2 border-brand/50 pl-2 text-[11px] italic leading-snug text-muted">
              {draft.quote.length > 120 ? `${draft.quote.slice(0, 120)}…` : draft.quote}
            </p>
            <Composer
              placeholder="Add a comment…"
              autoFocus
              onCancel={() => onDraftChange(null)}
              onSubmit={async (body) => {
                await comments.add({ body, quote: draft.quote, quoteOffset: draft.offset ?? null });
                onDraftChange(null);
              }}
            />
          </div>
        )}

        {loading && threads.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted">Loading…</p>
        ) : openThreads.length === 0 && !draft ? (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted">
            No open comments. Select text in the note to start a thread — agents can leave them here
            too, over MCP.
          </p>
        ) : (
          <ul className="space-y-2">
            {openThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                active={thread.id === activeThreadId}
                currentUserId={currentUserId}
                onFocus={() => onFocusThread(thread.id)}
                onReply={(body) => comments.add({ body, replyTo: thread.root.id })}
                onResolve={(resolved) => void comments.resolve(thread.id, resolved)}
                onDelete={(id) => void comments.remove(id)}
              />
            ))}
          </ul>
        )}

        {(resolvedThreads.length > 0 || showResolved) && (
          <div className="mt-3 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setShowResolved(!showResolved)}
              className="w-full px-1 text-left text-[11px] text-muted hover:text-ink"
            >
              {showResolved ? "Hide" : "Show"} resolved
              {resolvedThreads.length > 0 ? ` (${resolvedThreads.length})` : ""}
            </button>
            {showResolved && resolvedThreads.length > 0 && (
              <ul className="mt-2 space-y-2">
                {resolvedThreads.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeThreadId}
                    currentUserId={currentUserId}
                    onFocus={() => onFocusThread(thread.id)}
                    onReply={(body) => comments.add({ body, replyTo: thread.root.id })}
                    onResolve={(resolved) => void comments.resolve(thread.id, resolved)}
                    onDelete={(id) => void comments.remove(id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!canComment && (
        <p className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted">
          This connection is read-only, so you can read threads but not post.
        </p>
      )}
    </aside>
  );
}
