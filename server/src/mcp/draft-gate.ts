/**
 * draft-gate — two-phase commit for work documents.
 *
 * Specs, PRDs, plans and design docs are the writes worth reviewing before they
 * land: they are long, they are authored by the agent rather than dictated, and
 * a wrong one quietly becomes canon. So a write tool whose target looks like a
 * work document refuses to write on the first call. It returns the rendered
 * draft plus a `confirm_token`; the agent shows the draft to the owner, gets an
 * explicit yes, and calls the same tool again with an identical body plus the
 * token.
 *
 * The token is a hash of destination + content rather than a stored session:
 * the Streamable HTTP transport builds a fresh MCP server per request, so there
 * is nowhere to keep state, and content-addressing buys the property we want
 * anyway — editing the draft after the review invalidates the token and forces
 * another round.
 *
 * Everything else (memories, journal entries, people, quick appends) still
 * writes in the moment; the gate is deliberately narrow.
 */

import { createHash } from "node:crypto";

/** Note types that count as reviewable work docs (product / engineering / planning).
 *  Deliberately excludes living docs like `strategy` or `architecture`, which get
 *  edited constantly and would make the gate feel like friction. */
const WORK_DOC_TYPES: ReadonlySet<string> = new Set([
  "spec",
  "specs",
  "prd",
  "prds",
  "product-spec",
  "tech-spec",
  "technical-spec",
  "eng-spec",
  "design-doc",
  "design-spec",
  "rfc",
  "plan",
  "roadmap",
  "proposal",
]);

/** Path segments that hold work docs whatever the declared type says. */
const WORK_DOC_FOLDERS: ReadonlySet<string> = new Set([
  "specs",
  "prds",
  "plans",
  "rfcs",
  "proposals",
  "roadmaps",
]);

/** Appends shorter than this are edits, not a spec landing — they pass through. */
const APPEND_GATE_MIN_CHARS = 400;

const TOKEN_PREFIX = "draft_";

export type DraftOperation = "create" | "overwrite" | "append";

export interface DraftRequest {
  /** Space the note lands in — personal brain or company wiki. */
  spaceId: string;
  /** Company space slug, when the destination is a company wiki. */
  space?: string;
  /** Resolved destination path. */
  path: string;
  title: string;
  /** The markdown being written (or appended). */
  body: string | undefined;
  operation: DraftOperation;
  /** Declared note type, when the tool knows it. */
  type?: string;
  visibility?: string;
  /** Token echoed back by the agent after the owner confirmed. */
  confirmToken?: string;
}

function normalizeType(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** True when this destination is a product/engineering/planning document. */
export function isWorkDoc(input: { type?: string; path?: string; kind?: string }): boolean {
  if (WORK_DOC_TYPES.has(normalizeType(input.kind))) return true;
  if (WORK_DOC_TYPES.has(normalizeType(input.type))) return true;
  const segments = (input.path ?? "")
    .toLowerCase()
    .split("/")
    .slice(0, -1)
    .map((s) => s.trim());
  return segments.some((s) => WORK_DOC_FOLDERS.has(s));
}

/** Salt so the token can't be forged by a model that knows the payload. */
function salt(): string {
  return process.env.CONNECTION_ENC_KEY || process.env.CRON_SECRET || "ohmyself-draft-gate";
}

function tokenFor(parts: string[], prefix = TOKEN_PREFIX): string {
  const canonical = [salt(), ...parts].join("\u0000");
  return prefix + createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function draftTokenFor(req: DraftRequest): string {
  return tokenFor([
    req.spaceId,
    req.space ?? "",
    req.path.trim(),
    req.operation,
    (req.body ?? "").trim(),
  ]);
}

/** A local path the agent can drop the draft in when it has a filesystem. */
function localFileFor(path: string): string {
  const name = path.split("/").pop() || "draft.md";
  return `.ohmyself-drafts/${name.endsWith(".md") ? name : `${name}.md`}`;
}

export interface DraftPreview {
  status: "draft_pending_confirmation";
  applied: false;
  reason: string;
  destination: {
    space: string;
    path: string;
    action: DraftOperation;
    visibility?: string;
  };
  draft: { title: string; chars: number; lines: number; body: string };
  local_file: string;
  confirm_token: string;
  next_step: string[];
}

/**
 * Decide whether a write may proceed.
 *
 * Returns `null` when the tool should write (not a work doc, nothing
 * substantial to review, or the owner already confirmed this exact draft), and
 * a preview to return to the caller when it must not.
 */
export function reviewDraft(req: DraftRequest): DraftPreview | null {
  const body = (req.body ?? "").trim();
  if (!body) return null;
  if (!isWorkDoc({ type: req.type, path: req.path })) return null;
  if (req.operation === "append" && body.length < APPEND_GATE_MIN_CHARS) return null;

  const expected = draftTokenFor(req);
  const provided = (req.confirmToken ?? "").trim();
  if (provided === expected) return null;

  const stale = provided.length > 0;
  return {
    status: "draft_pending_confirmation",
    applied: false,
    reason: stale
      ? "The draft changed since the last preview, so the previous confirmation no longer applies. Here is the updated draft — review it with the owner again."
      : "This is a work document (spec / PRD / plan). Nothing was written yet: it needs the owner's explicit confirmation first.",
    destination: {
      space: req.space ?? "self",
      path: req.path,
      action: req.operation,
      ...(req.visibility ? { visibility: req.visibility } : {}),
    },
    draft: {
      title: req.title,
      chars: body.length,
      lines: body.split("\n").length,
      body,
    },
    local_file: localFileFor(req.path),
    confirm_token: expected,
    next_step: [
      "1. Show the owner the full draft above, rendered in the conversation — do not summarize it.",
      `2. If you can write files, also save it to \`${localFileFor(req.path)}\` and tell them the path so they can review it in their editor.`,
      "3. Ask for an explicit yes, and stop your turn there. Never confirm on the owner's behalf.",
      `4. Once they approve, call this tool again with the identical body plus confirm_token="${expected}".`,
      "5. If they ask for changes, send the edited body without a token to get a fresh preview.",
    ],
  };
}

export interface DeleteRequest {
  spaceId: string;
  space?: string;
  path: string;
  title: string;
  type: string;
  /** Current content, so a note edited after the preview needs a fresh look. */
  body: string;
  /** Notes that link to this one and would be left pointing at nothing. */
  backlinks: string[];
  confirmToken?: string;
}

export interface DeletePreview {
  status: "delete_pending_confirmation";
  deleted: false;
  reason: string;
  target: { space: string; path: string; title: string; type: string; chars: number };
  /** Empty means nothing links here — safe to remove per wiki-governance. */
  breaks_backlinks: string[];
  excerpt: string;
  confirm_token: string;
  next_step: string[];
}

/** Deleting is the one write that cannot be undone from the tool surface, so it
 *  always costs a round-trip: the first call reports what would be lost and
 *  which backlinks would break, and only a second call carrying the token
 *  removes the note. */
export function reviewDelete(req: DeleteRequest): DeletePreview | null {
  const expected = tokenFor([req.spaceId, req.space ?? "", req.path.trim(), "delete", req.body.trim()]);
  const provided = (req.confirmToken ?? "").trim();
  if (provided === expected) return null;

  const stale = provided.length > 0;
  const orphaned = req.backlinks.length === 0;
  return {
    status: "delete_pending_confirmation",
    deleted: false,
    reason: stale
      ? "The note changed since the last preview, so the previous confirmation no longer applies. Review it again."
      : "Deleting is irreversible from here. Nothing was removed yet.",
    target: {
      space: req.space ?? "self",
      path: req.path,
      title: req.title,
      type: req.type,
      chars: req.body.trim().length,
    },
    breaks_backlinks: req.backlinks,
    excerpt: req.body.trim().slice(0, 600),
    confirm_token: expected,
    next_step: [
      orphaned
        ? "1. Nothing links to this note, so removing it breaks no navigation."
        : `1. WARNING: ${req.backlinks.length} note(s) link here and would be left with a dead link. Rewrite those links first, or tell the owner before deleting.`,
      "2. Show the owner what is about to be lost — the title, the path and the excerpt above.",
      "3. Ask for an explicit yes and stop your turn there.",
      `4. Once they approve, call this tool again with confirm_token="${expected}".`,
    ],
  };
}
