import type { Brain } from "./brain.js";
import { slugify } from "./brain.js";
import type { UserConfig } from "./config.js";
import { todayISO } from "./frontmatter.js";
import type { IndexedNote, Visibility } from "./types.js";

/** Who owns a commitment: the user ("me") or a person (their slug). */
export type CommitmentOwner = "me" | string;
export type CommitmentStatus = "open" | "resolved" | "dropped";

export interface AddCommitmentInput {
  /** The commitment text, e.g. "Sebas will fix the RT map bug". */
  text: string;
  owner: CommitmentOwner;
  status?: CommitmentStatus;
  due?: string;
  /** When the commitment was made (the meeting date) — used for the file date,
   *  NOT the ingestion date. Defaults to today only if unknown. */
  date?: string;
  /** Path of the meeting note this came from. */
  source?: string;
  /** Link back to the raw source doc. */
  sourceUrl?: string;
  visibility?: Visibility;
}

export interface CommitmentWriteResult {
  ok: true;
  path: string;
  created: boolean;
  visibility: Visibility;
}

const BASE_TAG = "commitment";
const ownerTag = (o: CommitmentOwner) => `owner:${o === "me" ? "me" : slugify(o)}`;
const statusTag = (s: CommitmentStatus) => `status:${s}`;

function commitmentPath(text: string, date: string): string {
  return `commitments/${date.slice(0, 10)}-${slugify(text).slice(0, 60)}.md`;
}

function commitmentTags(owner: CommitmentOwner, status: CommitmentStatus): string[] {
  return [BASE_TAG, ownerTag(owner), statusTag(status)];
}

/** Create a commitment note under commitments/. These are meeting-derived
 *  commitments (context), NOT the user's task list — never surfaced as a
 *  generic to-do, and never auto-pushed to Flowya. */
export async function addCommitment(
  brain: Brain,
  userId: string,
  config: UserConfig,
  allowed: Visibility[],
  input: AddCommitmentInput,
): Promise<CommitmentWriteResult> {
  const status = input.status ?? "open";
  // The date the commitment was made (meeting date), not when we ingested it.
  const date = (input.date ?? todayISO()).slice(0, 10);
  const path = commitmentPath(input.text, date);
  const body = [
    `- **Owner:** ${input.owner}`,
    `- **Agreed:** ${date}`,
    input.due ? `- **Due:** ${input.due}` : null,
    input.source ? `- **From:** ${input.source}` : null,
    input.sourceUrl ? `- **Source:** ${input.sourceUrl}` : null,
    "",
    input.text.trim(),
  ]
    .filter((l) => l !== null)
    .join("\n");

  const { note, created } = await brain.upsertNote(
    userId,
    path,
    {
      type: "commitment",
      title: input.text.trim().slice(0, 120),
      body,
      tags: commitmentTags(input.owner, status),
      visibility: input.visibility,
      extra: {
        owner: input.owner,
        status,
        date,
        ...(input.due ? { due: input.due } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.sourceUrl ? { source_url: input.sourceUrl } : {}),
      },
    },
    config,
    allowed,
  );
  return { ok: true, path: note.path, created, visibility: note.meta.visibility };
}

/** Close/drop a commitment: updates its status tag + extra. Tags are replaced
 *  (not merged) so the old status:* tag is removed. */
export async function setCommitmentStatus(
  brain: Brain,
  userId: string,
  allowed: Visibility[],
  path: string,
  status: CommitmentStatus,
  opts?: { reason?: string },
): Promise<void> {
  const note = await brain.readNote(userId, path, allowed);
  const owner = (note.meta.extra?.owner as CommitmentOwner) ?? "me";
  const tags = note.meta.tags.filter((t) => !t.startsWith("status:"));
  tags.push(statusTag(status));
  const body = opts?.reason
    ? `${note.body.replace(/\s+$/, "")}\n\n> ${status} (${todayISO()}): ${opts.reason}\n`
    : note.body;
  await brain.updateNote(
    userId,
    path,
    { tags, body, extra: { status } },
    allowed,
  );
}

/** Link a commitment to a Flowya task once the user captures it there. */
export async function stampFlowyaTaskId(
  brain: Brain,
  userId: string,
  allowed: Visibility[],
  path: string,
  flowyaTaskId: string,
): Promise<void> {
  await brain.updateNote(userId, path, { extra: { flowya_task_id: flowyaTaskId } }, allowed);
}

export interface ListCommitmentsOptions {
  owner?: CommitmentOwner;
  status?: CommitmentStatus;
  allowed: Visibility[];
  limit?: number;
}

/** List commitments, precisely filtered by owner/status (AND semantics) by
 *  reading the facet tags off the index rows. */
export async function listCommitments(
  brain: Brain,
  userId: string,
  opts: ListCommitmentsOptions,
): Promise<IndexedNote[]> {
  const rows = await brain.listNotes(userId, {
    types: ["commitment"],
    allowed: opts.allowed,
    limit: opts.limit ?? 200,
  });
  return rows.filter((r) => {
    if (opts.owner && !r.tags.includes(ownerTag(opts.owner))) return false;
    if (opts.status && !r.tags.includes(statusTag(opts.status))) return false;
    return true;
  });
}
