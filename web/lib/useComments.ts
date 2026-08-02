"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { CommentThread } from "@/lib/types";

export interface AddCommentInput {
  body: string;
  quote?: string | null;
  quoteOffset?: number | null;
  replyTo?: string | null;
}

export interface CommentsController {
  threads: CommentThread[];
  loading: boolean;
  error: string | null;
  showResolved: boolean;
  setShowResolved: (v: boolean) => void;
  reload: () => Promise<void>;
  add: (input: AddCommentInput) => Promise<void>;
  resolve: (threadId: string, resolved: boolean) => Promise<void>;
  edit: (id: string, body: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * Comment threads for one note. Kept in the page (not the panel) because both
 * the panel and the editor's highlights render from the same list.
 *
 * `refreshKey` is bumped by the SSE stream, so a comment left by a teammate or
 * by an agent over MCP shows up without a reload.
 */
export function useComments({
  token,
  path,
  enabled = true,
  refreshKey = 0,
}: {
  token: string | null;
  path: string | null;
  enabled?: boolean;
  refreshKey?: number;
}): CommentsController {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const reload = useCallback(async () => {
    if (!token || !path || !enabled) {
      setThreads([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.comments(token, path, { includeResolved: showResolved });
      setThreads(res.threads);
      setError(null);
    } catch (e) {
      setThreads([]);
      setError(e instanceof Error ? e.message : "Could not load comments");
    } finally {
      setLoading(false);
    }
  }, [token, path, enabled, showResolved]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const mutate = useCallback(
    async (run: () => Promise<unknown>) => {
      try {
        await run();
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        await reload();
      }
    },
    [reload],
  );

  return {
    threads,
    loading,
    error,
    showResolved,
    setShowResolved,
    reload,
    add: (input) =>
      mutate(() => {
        if (!token || !path) throw new Error("no note open");
        return api.addComment(token, { path, ...input });
      }),
    resolve: (threadId, resolved) =>
      mutate(() => {
        if (!token) throw new Error("not signed in");
        return api.resolveComment(token, threadId, resolved);
      }),
    edit: (id, body) =>
      mutate(() => {
        if (!token) throw new Error("not signed in");
        return api.editComment(token, id, body);
      }),
    remove: (id) =>
      mutate(() => {
        if (!token) throw new Error("not signed in");
        return api.deleteComment(token, id);
      }),
  };
}
