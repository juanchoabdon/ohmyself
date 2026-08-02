/**
 * Inline comments on notes — the multiplayer layer over the vault.
 *
 * Humans comment from the web UI, agents comment over MCP, and both land in the
 * same threads. A thread is its root comment: the root owns the anchor and the
 * resolved state, replies just carry `parent_id` + the shared `thread_id`.
 *
 * Read access is gated by reading the note itself through `brain.readNote`,
 * which already enforces visibility — so a plain company-space member can never
 * see comments on a `secret` note. Write permission (is this caller allowed to
 * write at all) is checked by the callers, because commenting is deliberately
 * looser than editing: any member of a space may comment on what they can read.
 */
import {
  buildAnchor,
  parseAnchor,
  resolveAnchor,
  type AnchorMatch,
  type CommentAnchor,
} from "./anchor.js";
import type { Brain } from "./brain.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "./errors.js";
import { emitBrainEvent } from "./events.js";
import { serviceClient } from "./supabase.js";
import type { Visibility } from "./types.js";
import { nameOf, usersById } from "./users.js";

const MAX_BODY = 10_000;
const DEFAULT_OPEN_LIMIT = 30;

export type CommentAuthorKind = "human" | "agent";

export interface CommentAuthor {
  userId: string | null;
  kind: CommentAuthorKind;
  /** Display name for humans, client/agent name for MCP writes. */
  label: string;
}

export interface NoteComment {
  id: string;
  threadId: string;
  parentId: string | null;
  path: string;
  body: string;
  author: CommentAuthor;
  createdAt: string;
  updatedAt: string;
}

export interface CommentThread {
  id: string;
  path: string;
  anchor: CommentAnchor | null;
  /** Where the quote sits in the note body now; null when the text is gone. */
  match: AnchorMatch | null;
  orphaned: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  root: NoteComment;
  replies: NoteComment[];
}

export interface CommentActor {
  userId: string;
  kind: CommentAuthorKind;
  label?: string | null;
  /** Owner/admin of the space — may delete other people's comments. */
  isAdmin: boolean;
}

export interface AddCommentInput {
  path: string;
  body: string;
  /** Text to anchor to. Omit for a note-level comment. */
  quote?: string | null;
  /** Hint of where the quote sits, to disambiguate repeated text. */
  quoteOffset?: number | null;
  /** Join an existing thread instead of starting one. */
  replyTo?: string | null;
}

interface Row {
  id: string;
  space_id: string;
  path: string;
  thread_id: string;
  parent_id: string | null;
  author_user_id: string | null;
  author_kind: CommentAuthorKind;
  author_label: string | null;
  body: string;
  anchor: unknown;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, space_id, path, thread_id, parent_id, author_user_id, author_kind, author_label, body, anchor, resolved_at, resolved_by, created_at, updated_at";

function cleanBody(raw: string): string {
  const body = raw.trim();
  if (!body) throw new BadRequestError("comment body is required");
  return body.slice(0, MAX_BODY);
}

function toComment(row: Row, names: Map<string, string>): NoteComment {
  const label =
    row.author_kind === "human"
      ? (row.author_user_id && names.get(row.author_user_id)) || row.author_label || "someone"
      : row.author_label || "agent";
  return {
    id: row.id,
    threadId: row.thread_id,
    parentId: row.parent_id,
    path: row.path,
    body: row.body,
    author: { userId: row.author_user_id, kind: row.author_kind, label },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Resolve display names for every human author in one round-trip. */
async function nameMap(rows: Row[]): Promise<Map<string, string>> {
  const ids = rows.map((r) => r.author_user_id).filter((id): id is string => Boolean(id));
  const profiles = await usersById(ids);
  const names = new Map<string, string>();
  for (const [id, profile] of profiles) names.set(id, nameOf(profile));
  return names;
}

/** Group flat rows into threads, re-anchoring each root against `body`. */
function toThreads(rows: Row[], names: Map<string, string>, body: string | null): CommentThread[] {
  const roots = rows.filter((r) => !r.parent_id);
  const repliesByThread = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = repliesByThread.get(row.thread_id) ?? [];
    list.push(row);
    repliesByThread.set(row.thread_id, list);
  }

  return roots.map((root) => {
    const anchor = parseAnchor(root.anchor);
    const match = anchor && body != null ? resolveAnchor(body, anchor) : null;
    return {
      id: root.thread_id,
      path: root.path,
      anchor,
      match,
      orphaned: Boolean(anchor) && body != null && !match,
      resolvedAt: root.resolved_at,
      resolvedBy: root.resolved_by,
      root: toComment(root, names),
      replies: (repliesByThread.get(root.thread_id) ?? []).map((r) => toComment(r, names)),
    };
  });
}

/** Every thread on one note, oldest first. Throws if the caller can't read it. */
export async function listCommentThreads(
  brain: Brain,
  spaceId: string,
  path: string,
  allowed: Visibility[],
  opts?: { includeResolved?: boolean },
): Promise<CommentThread[]> {
  const note = await brain.readNote(spaceId, path, allowed);
  const sb = serviceClient();
  const { data, error } = await sb
    .from("note_comments")
    .select(COLUMNS)
    .eq("space_id", spaceId)
    .eq("path", path)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`list comments failed: ${error.message}`);

  const rows = (data ?? []) as Row[];
  const threads = toThreads(rows, await nameMap(rows), note.body);
  return opts?.includeResolved ? threads : threads.filter((t) => !t.resolvedAt);
}

/**
 * Unresolved threads across the whole space — the "what needs my attention"
 * inbox. Notes above the caller's visibility are filtered out via `note_index`.
 */
export async function listOpenThreads(
  spaceId: string,
  allowed: Visibility[],
  opts?: { limit?: number },
): Promise<CommentThread[]> {
  const limit = Math.min(Math.max(opts?.limit ?? DEFAULT_OPEN_LIMIT, 1), 200);
  const sb = serviceClient();
  const { data, error } = await sb
    .from("note_comments")
    .select(COLUMNS)
    .eq("space_id", spaceId)
    .is("parent_id", null)
    .is("resolved_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`list open threads failed: ${error.message}`);

  const roots = (data ?? []) as Row[];
  if (roots.length === 0) return [];

  const { data: visible } = await sb
    .from("note_index")
    .select("path")
    .eq("space_id", spaceId)
    .in("path", [...new Set(roots.map((r) => r.path))])
    .in("visibility", allowed);
  const readable = new Set((visible ?? []).map((r) => (r as { path: string }).path));
  const allowedRoots = roots.filter((r) => readable.has(r.path));
  if (allowedRoots.length === 0) return [];

  const { data: replyData } = await sb
    .from("note_comments")
    .select(COLUMNS)
    .in("thread_id", allowedRoots.map((r) => r.thread_id))
    .not("parent_id", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const rows = [...allowedRoots, ...((replyData ?? []) as Row[])];
  // No note body here (threads span many notes), so anchors stay unresolved.
  return toThreads(rows, await nameMap(rows), null);
}

async function loadComment(spaceId: string, id: string): Promise<Row> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("note_comments")
    .select(COLUMNS)
    .eq("space_id", spaceId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`load comment failed: ${error.message}`);
  if (!data) throw new NotFoundError("no such comment");
  return data as Row;
}

/**
 * Post a comment. With `quote` the thread anchors to that text; the quote must
 * exist in the note so an agent gets a hard error instead of a silently
 * misplaced comment.
 */
export async function addComment(
  brain: Brain,
  spaceId: string,
  allowed: Visibility[],
  actor: CommentActor,
  input: AddCommentInput,
): Promise<{ comment: NoteComment; thread: string; anchored: boolean }> {
  const body = cleanBody(input.body);

  let path = input.path.trim().replace(/^\/+/, "");
  let threadId: string | null = null;
  let parentId: string | null = null;

  if (input.replyTo) {
    const parent = await loadComment(spaceId, input.replyTo);
    threadId = parent.thread_id;
    parentId = parent.id;
    path = parent.path;
  }
  if (!path) throw new BadRequestError("path is required");

  // Gate on the note itself: readable note, readable comments.
  const note = await brain.readNote(spaceId, path, allowed);

  let anchor: CommentAnchor | null = null;
  if (!parentId && input.quote?.trim()) {
    anchor = buildAnchor(note.body, input.quote, input.quoteOffset ?? undefined);
    if (!anchor) {
      throw new BadRequestError(
        `that quote isn't in ${path} — quote text exactly as it appears in the note, or omit it for a note-level comment`,
      );
    }
  }

  const sb = serviceClient();
  const id = crypto.randomUUID();
  const { data, error } = await sb
    .from("note_comments")
    .insert({
      id,
      space_id: spaceId,
      path,
      thread_id: threadId ?? id,
      parent_id: parentId,
      author_user_id: actor.userId,
      author_kind: actor.kind,
      author_label: actor.label ?? null,
      body,
      anchor,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(`add comment failed: ${error?.message ?? "no row"}`);

  const row = data as Row;
  emitBrainEvent({
    type: "comment_created",
    spaceId,
    path,
    commentId: row.id,
    threadId: row.thread_id,
  });
  return {
    comment: toComment(row, await nameMap([row])),
    thread: row.thread_id,
    anchored: Boolean(anchor),
  };
}

/** Edit your own comment. */
export async function updateComment(
  spaceId: string,
  commentId: string,
  body: string,
  actor: CommentActor,
): Promise<NoteComment> {
  const current = await loadComment(spaceId, commentId);
  if (current.author_user_id !== actor.userId) {
    throw new ForbiddenError("you can only edit your own comments");
  }
  const sb = serviceClient();
  const { data, error } = await sb
    .from("note_comments")
    .update({ body: cleanBody(body), updated_at: new Date().toISOString() })
    .eq("space_id", spaceId)
    .eq("id", commentId)
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(`update comment failed: ${error?.message ?? "no row"}`);

  const row = data as Row;
  emitBrainEvent({
    type: "comment_updated",
    spaceId,
    path: row.path,
    commentId: row.id,
    threadId: row.thread_id,
  });
  return toComment(row, await nameMap([row]));
}

/**
 * Resolve (or reopen) a thread. Anyone who can comment can resolve — threads
 * are a shared workspace, not private mail — and we record who did it.
 */
export async function setThreadResolved(
  spaceId: string,
  threadId: string,
  resolved: boolean,
  actor: CommentActor,
): Promise<CommentThread> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("note_comments")
    .update({
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? actor.userId : null,
      updated_at: new Date().toISOString(),
    })
    .eq("space_id", spaceId)
    .eq("thread_id", threadId)
    .is("parent_id", null)
    .is("deleted_at", null)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`resolve comment failed: ${error.message}`);
  if (!data) throw new NotFoundError("no such comment thread");

  const root = data as Row;
  emitBrainEvent({
    type: resolved ? "comment_resolved" : "comment_updated",
    spaceId,
    path: root.path,
    commentId: root.id,
    threadId: root.thread_id,
  });
  const [thread] = toThreads([root], await nameMap([root]), null);
  return thread!;
}

/** Soft-delete a comment (whole thread when it's the root). */
export async function deleteComment(
  spaceId: string,
  commentId: string,
  actor: CommentActor,
): Promise<void> {
  const current = await loadComment(spaceId, commentId);
  if (current.author_user_id !== actor.userId && !actor.isAdmin) {
    throw new ForbiddenError("you can only delete your own comments");
  }
  const sb = serviceClient();
  const now = new Date().toISOString();
  const query = sb.from("note_comments").update({ deleted_at: now }).eq("space_id", spaceId);
  const { error } = current.parent_id
    ? await query.eq("id", commentId)
    : await query.eq("thread_id", current.thread_id);
  if (error) throw new Error(`delete comment failed: ${error.message}`);

  emitBrainEvent({
    type: "comment_deleted",
    spaceId,
    path: current.path,
    commentId: current.id,
    threadId: current.thread_id,
  });
}

/** Follow a note through a rename so its threads don't get stranded. Never
 *  fails a move: losing the anchor is better than losing the rename. */
export async function retargetComments(spaceId: string, from: string, to: string): Promise<void> {
  try {
    const { error } = await serviceClient()
      .from("note_comments")
      .update({ path: to })
      .eq("space_id", spaceId)
      .eq("path", from);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(`[comments] retarget ${from} -> ${to} failed:`, err);
  }
}

/** Open-thread counts per note path, for badges in the sidebar/header. */
export async function openThreadCounts(
  spaceId: string,
  paths: string[],
): Promise<Record<string, number>> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return {};
  const sb = serviceClient();
  const { data, error } = await sb
    .from("note_comments")
    .select("path")
    .eq("space_id", spaceId)
    .in("path", unique)
    .is("parent_id", null)
    .is("resolved_at", null)
    .is("deleted_at", null);
  if (error || !data) return {};
  const counts: Record<string, number> = {};
  for (const row of data as { path: string }[]) {
    counts[row.path] = (counts[row.path] ?? 0) + 1;
  }
  return counts;
}
