"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FullNote } from "@/lib/types";
import { VisibilityBadge } from "./VisibilityBadge";

export function NoteView({
  note,
  loading,
  onOpenLink,
}: {
  note: FullNote | null;
  loading: boolean;
  onOpenLink: (path: string) => void;
}) {
  if (loading) {
    return <Centered>Loading…</Centered>;
  }
  if (!note) {
    return (
      <Centered>
        <div className="max-w-sm text-center">
          <h2 className="text-lg font-semibold text-ink">Pick a note</h2>
          <p className="mt-1 text-sm text-muted">
            Choose something from your brain on the left, or ask a question.
          </p>
        </div>
      </Centered>
    );
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-8 py-10">
      <header className="mb-6 border-b border-border pb-5">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          <span className="rounded bg-bg px-1.5 py-0.5 font-medium capitalize">{note.meta.type}</span>
          <VisibilityBadge visibility={note.meta.visibility} />
          {note.meta.updated && <span>· updated {note.meta.updated}</span>}
        </div>
        <h1 className="text-[1.7rem] font-bold tracking-tight text-balance">{note.meta.title}</h1>
        {note.meta.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {note.meta.tags.map((t) => (
              <span key={t} className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted">
                #{t}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown>
      </div>

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
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center text-muted">{children}</div>;
}
