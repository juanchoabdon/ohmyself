import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addComment,
  addToProject,
  agentImage,
  allowedVisibilities,
  assetRefsInBody,
  assetUri,
  createAsset,
  effectiveAllowed,
  effectiveAllowedForRole,
  buildCore,
  buildFriendDirectory,
  canWrite,
  distillEnabled,
  fetchRemoteMedia,
  getAsset,
  listAssets,
  mediaBlockFor,
  parseAssetRef,
  resolveAssets,
  MAX_VIDEO_BYTES,
  folderForType,
  isPersonalBrain,
  getDisplayName,
  getUserConfig,
  projectDocPath,
  ingest,
  listCommentThreads,
  listCommitments,
  listOpenThreads,
  listSpacesForUser,
  profilePerson,
  profileStalePeople,
  researchBrain,
  serializeNote,
  setCommitmentStatus,
  setThreadResolved,
  setUserConfig,
  slugify,
  stampFlowyaTaskId,
  todayISO,
  upsertPerson,
  upsertProject,
  writeBrain,
  attributionFromAuth,
  type AuthContext,
  type CommentActor,
  type CommentThread,
  type CommitmentOwner,
  type CommitmentStatus,
  type FriendEntry,
  type NoteAsset,
  type NoteType,
  type ProjectKind,
  type Space,
  type SpaceRole,
  type UserConfig,
  type Visibility,
} from "../core/index.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../core/errors.js";
import { buildPaletteResponse } from "../core/palette.js";
import { buildPreviewUrl } from "../core/preview-url.js";
import { getLinkContext } from "../core/link-intelligence.js";
import { applyLintCull, applyLintMerge, applyLintRehome, getLintReport } from "../lint.js";
import {
  isWorkDoc,
  reviewDelete,
  reviewDraft,
  type DraftOperation,
  type DraftPreview,
  type DraftRequest,
} from "./draft-gate.js";
import { instrumentToolUsage } from "./telemetry.js";

const VisibilityEnum = z.enum(["public", "private", "secret"]);

/** The public MCP tool contract version. Bumped for the retrieval architecture
 *  (research_brain + graph primitives + write_brain + routing policy), then for
 *  the multiplayer comment tools, then for the work-doc draft gate + the `url`
 *  every write now returns, then for the gate honoring a stored note's type,
 *  then for move_space_note + delete_space_note, then for media (add_media /
 *  get_media / list_media and the oms-asset: reference scheme). Kept stable
 *  even as the embedding model / reranker / planner change underneath. */
const CONTRACT_VERSION = "2.13";

/** Tools marked deprecated by contract v2. Empty until telemetry confirms an
 *  active tool has a stable replacement and no live callers — then it moves
 *  here (its description should also gain a "(deprecated → use X)" hint). The
 *  telemetry layer flags every call to a name in this set so we can watch it
 *  drain to zero before removal. */
const DEPRECATED_TOOLS: ReadonlySet<string> = new Set<string>([
  // Tasks belong in Flowya, not the brain (matches the owner's operating rules).
  "add_todo",
]);

function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

/** Build a goal path from a period like "2026", "2026-q3", "2026-06". */
function goalPath(period: string): string {
  const p = period.trim().toLowerCase();
  const m = /^(\d{4})(?:[-_\s]?(q[1-4]|h[12]|\d{2}))?$/.exec(p);
  if (m) return `goals/${m[1]}/${m[2] ?? "yearly"}.md`;
  return `goals/${slugify(period)}.md`;
}

/** A skill lives at skills/<slug>/SKILL.md. The first blockquote line is the
 *  "when to use" description; the rest is the instruction body. */
function skillPath(name: string): string {
  return `skills/${slugify(name)}/SKILL.md`;
}

/** Where things live, for the taxonomy of the space actually being addressed. A
 *  company wiki has no identity page, journal or `projects/`; describing the
 *  personal pillars to an agent writing into one is how company docs ended up
 *  as `projects/<slug>/_index.md`. */
function conventionsFor(cfg: UserConfig): Record<string, string> {
  if (isPersonalBrain(cfg)) {
    return {
      identity: "identity/about-me.md (use update_identity)",
      goals: "goals/<year>/yearly.md or goals/<year>/q<n>.md (use set_goal)",
      projects:
        "projects/<slug>/_index.md is the overview; nest docs in prds/, specs/, transcripts/, notes/, subprojects/<slug>/_index.md (use upsert_project, add_to_project)",
      people: "people/<slug>.md (use add_person)",
      journal: "journal/<year>/<date>.md (use log_journal)",
      todos: "todos/<list>.md as checkbox lines (use add_todo)",
      memory: "memory/log.md — quick durable facts learned in conversation (use remember)",
    };
  }
  const folders = [...new Set(cfg.noteTypes.map((t) => t.folder))];
  return {
    documents: `<folder>/<slug>.md, one folder per category: ${folders.join(", ")}. Pick the category with create_space_note's \`type\`, or let write_space classify it.`,
    people: "people/<slug>.md — a teammate, investor or candidate",
    no_personal_pillars:
      "this is a company wiki, not a brain: it has no identity page, no journal, no memory log and no `projects/`. A strategy, doctrine, plan or spec is a document under its own category (thesis, product, gtm, decisions), so upsert_project / add_to_project / log_journal / remember do not apply here.",
  };
}

/** Build an MCP server whose tools operate on `auth`'s brain, scoped to its
 *  visibility level. Used by both the stdio and Streamable HTTP transports.
 *  Async because it lists the user's skills to expose them as MCP prompts. */
export async function buildMcpServer(auth: AuthContext): Promise<McpServer> {
  const core = buildCore();
  const { brain } = core;
  const allowed = effectiveAllowed(auth);
  const server = new McpServer(
    { name: "ohmyself", version: "0.3.0" },
    {
      instructions: [
        "This is the person's second brain (private notes: identity, people, projects, goals, decisions, journal).",
        "",
        "RETRIEVAL ROUTING — pick the lightest tool that answers the need:",
        "- search_brain: ranked notes for a keyword/topic lookup (fastest).",
        "- recall: one hybrid retrieval + aggregated context to ground an answer about a topic. Use before answering questions about the person. If `coverage` is low, treat context as incomplete.",
        "- research_brain: DEEP path for hard, multi-hop, or synthesis questions ('why did I decide X', 'how do A and B connect', 'the story of Z over time'). It plans sub-queries, searches repeatedly, follows links, reads notes, and returns a cited `answer`. Slower/costlier — don't use it for a single fact.",
        "- get_neighbors / get_backlinks / search_by_entity / timeline: navigate the graph around a note or entity, or scan a time window.",
        "",
        "SPACES: the same retrieval routing applies to company wikis you belong to (list_spaces). Use the *_space variants (recall_space, search_space, research_space, get_space_neighbors, get_space_backlinks, search_space_by_entity, space_timeline) instead of the personal tools when the question is about a company (e.g. Bonds). Never answer about a company from the personal brain.",
        "",
        "FRIENDS: brains shared with you (list_friends) mirror the same read routing via *_friend variants: recall_friend / search_friend_brain (fast), research_friend (deep), get_friend_neighbors / get_friend_backlinks / search_friend_by_entity / friend_timeline (navigate). Always read-only; capped at the visibility they granted. Never answer about a friend from your own brain.",
        "",
        "WRITING: prefer the specific tools (remember, add_person, upsert_project, add_to_project, set_goal, log_journal, update_identity) when you know the destination. Use write_brain to auto-route + dedupe when you don't. For a company wiki use the *_space write tools (create_space_note / update_space_note / append_space_note, or write_space to auto-route). Never invent facts; capture durable info in the moment.",
        "",
        "MEDIA: notes can embed images and video. In a body they appear as a `:::image` / `:::video` block whose `src` is `oms-asset:<id>` — that is a reference, not a URL, and you cannot read the picture from the markdown. To SEE one, call get_media with that reference; the image comes back as visual content you can reason about. Do that whenever the answer depends on what the image shows. To store one (the person shares a screenshot, a diagram, a photo), call add_media with base64 `data` or a `source_url`, plus `note_path` to embed it. list_media shows what exists. Never invent an oms-asset id.",
        "",
        "WORK DOCS NEED CONFIRMATION: specs, PRDs, plans, RFCs and design docs are never written on the first call — in the personal brain or in a company wiki. The tool returns `status: draft_pending_confirmation` with the full draft and a `confirm_token`. Show the owner the whole draft in the conversation (and write it to the suggested `local_file` if you have filesystem access), ask for an explicit yes, and END YOUR TURN. Only after they approve, call the same tool again with the identical body plus `confirm_token`. Never confirm on the owner's behalf, and never chain the preview and the confirmed write in one turn. If they ask for edits, resend the new body without a token.",
        "",
        "AFTER WRITING: every write returns a `url` deep link to the note. Always surface that link to the owner so they can open what you just saved.",
      ].join("\n"),
    },
  );

  // Wrap tool handlers with usage telemetry (must run before any registerTool).
  instrumentToolUsage(server, auth, DEPRECATED_TOOLS);

  function requireWrite() {
    if (auth.readonly || !canWrite(auth.scope)) {
      throw new ForbiddenError("this connection is read-only (public scope)");
    }
  }
  let _config: UserConfig | null = null;
  async function config(): Promise<UserConfig> {
    return (_config ??= await getUserConfig(auth.spaceId));
  }
  async function upsert(
    path: string,
    input: Parameters<typeof brain.upsertNote>[2],
  ) {
    requireWrite();
    const { note, created } = await brain.upsertNote(auth.spaceId, path, input, await config(), allowed);
    return { ok: true, path: note.path, created, visibility: note.meta.visibility };
  }

  /** Attach the web deep link to a write result so the caller can hand the
   *  owner a link without a second round-trip through preview_url. */
  function withUrl<T extends object>(res: T, spaceId = auth.spaceId): T & { url?: string } {
    const r = res as Record<string, unknown>;
    // write_brain/write_space previews resolve a path they haven't written yet.
    if (r.applied === false) return res;
    const target = [r.path, r.created, r.updated, r.appended].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );
    if (!target) return res;
    return { ...res, url: buildPreviewUrl(target, spaceId) };
  }

  const confirmTokenSchema = z
    .string()
    .optional()
    .describe(
      "for specs/PRDs/plans only: the token from this tool's draft preview, sent back after the owner explicitly approved the draft. Omit it on the first call.",
    );

  /** Hold a work-doc write until the owner has seen the draft and approved it.
   *  Returns the preview to hand back, or null when the write may proceed. */
  async function gateWorkDoc(
    req: Omit<DraftRequest, "operation" | "title"> & {
      title?: string;
      append?: boolean;
      scope?: Visibility[];
    },
  ): Promise<DraftPreview | null> {
    if (!req.body?.trim()) return null;
    const declared = isWorkDoc({ type: req.type, path: req.path });
    // Updates and appends only name a path, so the note's own type decides —
    // Bonds files specs under engineering/ as well as under product/specs/.
    if (!declared && req.type) return null;

    const existing = await brain
      .readNote(req.spaceId, req.path, req.scope ?? allowed)
      .catch(() => null);
    const type = req.type ?? existing?.meta.type;
    if (!declared && !isWorkDoc({ type })) return null;

    const operation: DraftOperation = req.append ? "append" : existing ? "overwrite" : "create";
    return reviewDraft({
      ...req,
      type,
      title: req.title ?? existing?.meta.title ?? req.path,
      operation,
    });
  }

  /**
   * Notes come back as raw markdown, where an embedded image is just
   * `src: oms-asset:<id>` — unreadable on its own. Append a short index so the
   * agent knows those references are fetchable, and with what.
   */
  async function withMediaIndex(spaceId: string, markdown: string): Promise<string> {
    const ids = assetRefsInBody(markdown);
    if (ids.length === 0) return markdown;
    const assets = await Promise.all(
      ids.map((id) => getAsset(spaceId, id).catch(() => null)),
    );
    const lines = assets
      .filter((a): a is NoteAsset => a !== null)
      .map((a) => {
        const size = a.width && a.height ? `, ${a.width}x${a.height}` : "";
        return `- ${assetUri(a.id)} — ${a.kind} (${a.mime}${size})${a.originalName ? ` "${a.originalName}"` : ""}`;
      });
    if (lines.length === 0) return markdown;
    return `${markdown}\n\n---\nMedia embedded above — call get_media with one of these to actually see it:\n${lines.join("\n")}\n`;
  }

  /** Where create_note / create_space_note will put a note, mirroring Brain.createNote. */
  function derivedPath(cfg: UserConfig, type: string, title: string, explicit?: string): string {
    const given = explicit?.trim().replace(/^\/+/, "");
    if (given) return given;
    return `${folderForType(cfg, type || "note")}/${slugify(title)}.md`;
  }

  // ── Read / recall ────────────────────────────────────────────────────────

  server.registerTool(
    "search_brain",
    {
      title: "Search",
      description:
        "Hybrid (semantic + keyword) search across the person's notes. Returns ranked notes (path, title, type, visibility, tags, excerpt) with a relevance `score`, `matchReasons` (semantic/lexical/title/recent) and the matched `section`. Finds notes even when wording differs from the query. Respects privacy.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().describe("search terms"),
        types: z.array(z.string()).optional().describe("filter by note types"),
        tags: z.array(z.string()).optional().describe("filter by tags (any match)"),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ query, types, tags, limit }) => {
      const res = await brain.search(auth.spaceId, query, { allowed, types, tags, limit });
      return text(res);
    },
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "List notes, optionally filtered by type and tags. Respects privacy.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ type, tags, limit }) => {
      const res = await brain.listNotes(auth.spaceId, {
        allowed,
        types: type ? [type] : undefined,
        tags,
        limit,
      });
      return text(res);
    },
  );

  server.registerTool(
    "read_note",
    {
      title: "Read a note",
      description:
        "Read the full markdown (frontmatter + body) of a note by its path. If it embeds images or video, the reply lists their `oms-asset:` references — pass one to get_media to actually see it.",
      annotations: { readOnlyHint: true },
      inputSchema: { path: z.string().describe("relative note path, e.g. projects/x/_index.md") },
    },
    async ({ path }) => {
      const note = await brain.readNote(auth.spaceId, path, allowed);
      return text(await withMediaIndex(auth.spaceId, serializeNote(note.meta, note.body)));
    },
  );

  server.registerTool(
    "recall",
    {
      title: "Recall about a topic",
      description:
        "Recall everything relevant about a topic or question using hybrid retrieval. Returns `text` (aggregated context to ground an answer), `notes`, `sources` (per-hit path/section/score/match_reasons), `coverage` (high|medium|low retrieval confidence), `graph_hints` (one-hop related notes from top hits), and `suggested_followups`. Use before answering questions about the person; if `coverage` is low, treat the context as incomplete rather than authoritative.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        topic: z.string().describe("the topic or question to recall context for"),
        limit: z.number().int().positive().max(20).optional(),
      },
    },
    async ({ topic, limit }) => {
      const ctx = await brain.getContext(auth.spaceId, topic, allowed, limit ?? 6);
      return text(ctx);
    },
  );

  server.registerTool(
    "research_brain",
    {
      title: "Research a question (deep)",
      description:
        "DEEP retrieval for hard, multi-hop, or synthesis questions ('why did I decide X?', 'how do my goals connect to project Y?', 'what's the story of Z across time?'). Runs a bounded loop: plans sub-queries, does multiple hybrid searches, follows links/backlinks, reads the top notes, and returns a synthesized `answer` with `sources` (cited paths), `coverage` (high|medium|low), `suggested_followups`, and a `trace`. Slower/costlier than recall — for a single fact or a quick topic lookup, use `recall` or `search_brain` instead. Respects privacy.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        question: z.string().describe("the question to research over the brain"),
        max_searches: z.number().int().positive().max(8).optional().describe("cap on hybrid searches (default 5)"),
        max_reads: z.number().int().positive().max(15).optional().describe("cap on notes read in full (default 8)"),
      },
    },
    async ({ question, max_searches, max_reads }) => {
      const res = await researchBrain(brain, auth.spaceId, question, allowed, {
        maxSearches: max_searches,
        maxReads: max_reads,
      });
      return text(res);
    },
  );

  server.registerTool(
    "get_backlinks",
    {
      title: "Get backlinks",
      description:
        "List notes that link TO a given note (incoming links). Use to see what references a person, project, or concept page. Respects privacy.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z.string().describe("the note whose backlinks you want, e.g. people/ana.md"),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async ({ path, limit }) => {
      const res = await brain.getBacklinks(auth.spaceId, path, allowed, limit ?? 50);
      return text(res);
    },
  );

  server.registerTool(
    "get_neighbors",
    {
      title: "Get neighboring notes",
      description:
        "Explore a note's neighborhood in the knowledge graph: `outgoing` (explicit links), `backlinks` (incoming links), and `semantic` (topically similar notes by embedding). Use to navigate related context around a note. Respects privacy.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z.string().describe("the note to explore, e.g. projects/bonds/_index.md"),
        semantic_limit: z.number().int().positive().max(15).optional().describe("how many semantic neighbors (default 6)"),
      },
    },
    async ({ path, semantic_limit }) => {
      const res = await brain.getNeighbors(auth.spaceId, path, allowed, { semanticLimit: semantic_limit });
      return text(res);
    },
  );

  server.registerTool(
    "search_by_entity",
    {
      title: "Search by entity",
      description:
        "Find everything the brain knows about a named person, project, or concept: its canonical page (`entity`) plus the notes that mention or link to it (`mentions`). Use when the question centers on a specific named thing. Respects privacy.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        name: z.string().describe("the person, project, or concept name"),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ name, limit }) => {
      const res = await brain.searchByEntity(auth.spaceId, name, allowed, { limit });
      return text(res);
    },
  );

  server.registerTool(
    "timeline",
    {
      title: "Timeline of notes",
      description:
        "List notes chronologically within an optional date window — great for 'what happened / what did I work on' over a period. Order by `created` (default) or `updated`, filter by type/tag/path prefix. Respects privacy.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        from: z.string().optional().describe("inclusive start date YYYY-MM-DD"),
        to: z.string().optional().describe("inclusive end date YYYY-MM-DD"),
        by: z.enum(["created", "updated"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        type: z.string().optional(),
        tags: z.array(z.string()).optional(),
        prefix: z.string().optional().describe("path prefix filter, e.g. journal/"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ from, to, by, order, type, tags, prefix, limit }) => {
      const res = await brain.timeline(auth.spaceId, {
        allowed,
        from,
        to,
        by,
        order,
        types: type ? [type] : undefined,
        tags,
        prefix,
        limit,
      });
      return text(res);
    },
  );

  server.registerTool(
    "who_am_i",
    {
      title: "Who am I",
      description:
        "Answer 'who is this person?' by aggregating their identity pages (identity/*: about-me, values, bio, etc.) into a single profile. Use this whenever asked who the person is, for an intro/bio, or to ground a personal answer. To change any of it, use update_identity. Read-only; respects privacy.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => {
      const name = await getDisplayName(auth.spaceId);
      // Framing instruction so the agent answers in-character as the second self.
      const persona = name
        ? `You are speaking as the second self of ${name}. Begin your reply with "I'm the second self of ${name}." then summarize who they are using only the profile below.`
        : `You are speaking as this person's second self. Begin your reply with "I'm your second self." then summarize who they are using only the profile below.`;

      const idNotes = await brain.listNotes(auth.spaceId, { allowed, types: ["identity"], limit: 50 });
      if (idNotes.length === 0) {
        return text(
          `${persona}\n\n(No identity has been set yet — say so briefly and invite them to add it. ` +
            `Identity is saved with the update_identity tool, starting at identity/about-me.md, then facets like 'values' or 'bio'.)`,
        );
      }
      // about-me first, then the rest alphabetically for a stable, readable profile.
      const ordered = [...idNotes].sort((a, b) => {
        const am = (p: string) => (p.endsWith("identity/about-me.md") ? 0 : 1);
        return am(a.path) - am(b.path) || a.path.localeCompare(b.path);
      });
      const sections: string[] = [];
      for (const n of ordered) {
        try {
          const note = await brain.readNote(auth.spaceId, n.path, allowed);
          const body = note.body.trim();
          if (!body) continue;
          sections.push(`## ${note.meta.title || n.title || n.path}\n\n${body}`);
        } catch {
          /* skip unreadable pages */
        }
      }
      if (sections.length === 0) {
        return text(
          `${persona}\n\n(Identity pages exist but are empty — say so briefly and invite them to fill them in with update_identity.)`,
        );
      }
      return text(`${persona}\n\n---\n\n# Identity profile\n\n${sections.join("\n\n---\n\n")}`);
    },
  );

  server.registerTool(
    "get_structure",
    {
      title: "Get structure & conventions",
      description:
        "Return the taxonomy (categories + folders) and the conventions for where things live. Call this first when you're unsure where to write something — or before changing the taxonomy itself. To customize the top level (add a new category like 'Social media', rename or refile one) use upsert_category; to drop one use remove_category.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => {
      const cfg = await config();
      return text({
        contract_version: CONTRACT_VERSION,
        scope: auth.scope,
        canWrite: !auth.readonly && canWrite(auth.scope),
        retrieval_routing: {
          fast_recall: "recall / search_brain — narrow, explicit questions; 1-2 notes suffice",
          deep_research: "research_brain — ambiguous, multi-hop, history/synthesis, or low coverage",
          navigate: "get_neighbors / get_backlinks / search_by_entity / timeline",
          write: "specific write tools when destination is known; write_brain to auto-route + dedupe; history + restore_version + activity for version timeline; palette (starters + component schemas) for rich embeds; preview_url for live web preview; link_context for graph hints",
          work_docs:
            "specs / PRDs / plans / RFCs / design docs are never written on the first call, in the self space or in a company wiki. The tool returns `status: draft_pending_confirmation` with the full draft, a suggested `local_file`, and a `confirm_token`. Show the owner the draft, get an explicit yes, end the turn, then call again with the identical body + confirm_token. Editing the draft invalidates the token.",
          links: "every write returns a `url` deep link — always give it to the owner after saving",
          comments:
            "list_comments / add_comment / resolve_comment (and list_space_comments / add_space_comment / resolve_space_comment for company wikis) — talk to the person on a note without editing it. `quote` anchors a comment to an exact span, which shows as a highlight in the app; list_comments with no path returns every open thread, i.e. what still needs attention. Any space member can comment, including roles that cannot write notes.",
          spaces:
            "company wikis (list_spaces) mirror the same routing via *_space variants: recall_space / search_space (fast), research_space (deep), get_space_neighbors / get_space_backlinks / search_space_by_entity / space_timeline (navigate), create_space_note / update_space_note / append_space_note / write_space (write, owner/admin)",
          friends:
            "shared brains (list_friends) mirror the same read routing via *_friend variants: recall_friend / search_friend_brain (fast), research_friend (deep), get_friend_neighbors / get_friend_backlinks / search_friend_by_entity / friend_timeline (navigate) — always read-only, capped at granted visibility",
          media:
            "add_media stores an image/video and returns an oms-asset:<id> reference; get_media returns an image as visual content you can actually look at; list_media enumerates what exists. All three take an optional `space` slug instead of having *_space twins.",
        },
        media: {
          reference_scheme:
            "note bodies embed media as a :::image or :::video block whose `src` is `oms-asset:<id>`. It is an opaque reference, not a URL — the bytes live in a private bucket and are only reachable through get_media or a short-lived signed url. Never fabricate an id.",
          limits: "images up to 10 MB (png, jpeg, webp, gif, avif); video up to 50 MB (mp4, webm, mov)",
          vision:
            "get_media downscales images to at most 1568px before returning them, so reading one is cheap. Video is never returned as content — models can't watch it.",
        },
        categories: cfg.noteTypes,
        conventions: conventionsFor(cfg),
      });
    },
  );

  // ── Friends (read-only access to brains shared with you) ──────────────────
  // A friend's brain is addressable by a stable `friend` slug — see
  // list_friends. Access is capped at whatever visibility THEY granted,
  // regardless of your own scope, and is always read-only.

  let _friends: FriendEntry[] | null = null;
  async function friends(): Promise<FriendEntry[]> {
    return (_friends ??= await buildFriendDirectory(auth.userId));
  }
  function findFriend(list: FriendEntry[], slug: string): FriendEntry {
    const found = list.find((f) => f.slug === slug);
    if (!found) {
      throw new NotFoundError(`no friend '${slug}' — call list_friends to see who has shared with you`);
    }
    return found;
  }
  async function friendIdentityText(ownerId: string, name: string, allowed: Visibility[]): Promise<string> {
    const idNotes = await brain.listNotes(ownerId, { allowed, types: ["identity"], limit: 50 });
    if (idNotes.length === 0) return `No identity info has been shared for ${name}.`;
    const ordered = [...idNotes].sort((a, b) => {
      const am = (p: string) => (p.endsWith("identity/about-me.md") ? 0 : 1);
      return am(a.path) - am(b.path) || a.path.localeCompare(b.path);
    });
    const sections: string[] = [];
    for (const n of ordered) {
      try {
        const note = await brain.readNote(ownerId, n.path, allowed);
        const body = note.body.trim();
        if (!body) continue;
        sections.push(`## ${note.meta.title || n.title || n.path}\n\n${body}`);
      } catch {
        /* skip unreadable pages */
      }
    }
    if (sections.length === 0) return `Identity info exists for ${name} but is empty.`;
    return `# ${name}'s profile (shared with you)\n\n${sections.join("\n\n---\n\n")}`;
  }

  server.registerTool(
    "list_friends",
    {
      title: "List friends",
      description:
        "List the people who've shared their brain (read-only) with you. Returns each friend's slug (use it as the `friend` argument for recall_friend, search_friend_brain, research_friend, list_friend_notes, read_friend_note, who_is_friend, get_friend_neighbors, get_friend_backlinks, search_friend_by_entity, friend_timeline) and the visibility level they granted you.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => text((await friends()).map((f) => ({ friend: f.slug, name: f.name, maxVisibility: f.maxVisibility }))),
  );

  server.registerTool(
    "recall_friend",
    {
      title: "Recall about a friend's topic",
      description:
        "Recall everything a friend has shared that's relevant to a topic — same as recall, but scoped to a friend's brain. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        friend: z.string().describe("friend slug from list_friends"),
        topic: z.string().describe("the topic or question to recall context for"),
        limit: z.number().int().positive().max(20).optional(),
      },
    },
    async ({ friend, topic, limit }) => {
      const f = findFriend(await friends(), friend);
      const ctx = await brain.getContext(f.ownerId, topic, allowedVisibilities(f.maxVisibility), limit ?? 6);
      return text(ctx);
    },
  );

  server.registerTool(
    "search_friend_brain",
    {
      title: "Search a friend's brain",
      description:
        "Full-text search across a friend's notes — same as search_brain, but scoped to a friend's brain. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        friend: z.string().describe("friend slug from list_friends"),
        query: z.string().describe("search terms"),
        types: z.array(z.string()).optional().describe("filter by note types"),
        tags: z.array(z.string()).optional().describe("filter by tags (any match)"),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ friend, query, types, tags, limit }) => {
      const f = findFriend(await friends(), friend);
      const res = await brain.search(f.ownerId, query, {
        allowed: allowedVisibilities(f.maxVisibility),
        types,
        tags,
        limit,
      });
      return text(res);
    },
  );

  server.registerTool(
    "list_friend_notes",
    {
      title: "List a friend's notes",
      description:
        "List a friend's notes, optionally filtered by type and tags — same as list_notes, but scoped to a friend's brain. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        friend: z.string().describe("friend slug from list_friends"),
        type: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ friend, type, tags, limit }) => {
      const f = findFriend(await friends(), friend);
      const res = await brain.listNotes(f.ownerId, {
        allowed: allowedVisibilities(f.maxVisibility),
        types: type ? [type] : undefined,
        tags,
        limit,
      });
      return text(res);
    },
  );

  server.registerTool(
    "read_friend_note",
    {
      title: "Read a friend's note",
      description:
        "Read the full markdown of one of a friend's notes by path — same as read_note, but scoped to a friend's brain. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        friend: z.string().describe("friend slug from list_friends"),
        path: z.string().describe("relative note path, e.g. projects/x/_index.md"),
      },
    },
    async ({ friend, path }) => {
      const f = findFriend(await friends(), friend);
      const note = await brain.readNote(f.ownerId, path, allowedVisibilities(f.maxVisibility));
      return text(serializeNote(note.meta, note.body));
    },
  );

  server.registerTool(
    "who_is_friend",
    {
      title: "Who is this friend",
      description:
        "Summarize who a friend is from the identity pages they've shared with you. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: { friend: z.string().describe("friend slug from list_friends") },
    },
    async ({ friend }) => {
      const f = findFriend(await friends(), friend);
      return text(await friendIdentityText(f.ownerId, f.name, allowedVisibilities(f.maxVisibility)));
    },
  );

  server.registerTool(
    "research_friend",
    {
      title: "Research a friend's brain (deep)",
      description:
        "DEEP retrieval over a friend's shared brain — same as research_brain, but scoped to a friend. For hard, multi-hop, or synthesis questions ('why did they decide X?', 'how do their goals connect to project Y?', 'what's the story of Z across time?'). Plans sub-queries, does multiple hybrid searches, follows links, reads the top notes, and returns a synthesized `answer` with cited `sources`, `coverage`, `suggested_followups`, and a `trace`. Slower/costlier — for a single fact use recall_friend or search_friend_brain. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        friend: z.string().describe("friend slug from list_friends"),
        question: z.string().describe("the question to research over the friend's brain"),
        max_searches: z.number().int().positive().max(8).optional().describe("cap on hybrid searches (default 5)"),
        max_reads: z.number().int().positive().max(15).optional().describe("cap on notes read in full (default 8)"),
      },
    },
    async ({ friend, question, max_searches, max_reads }) => {
      const f = findFriend(await friends(), friend);
      const res = await researchBrain(brain, f.ownerId, question, allowedVisibilities(f.maxVisibility), {
        maxSearches: max_searches,
        maxReads: max_reads,
      });
      return text(res);
    },
  );

  server.registerTool(
    "get_friend_backlinks",
    {
      title: "Get backlinks in a friend's brain",
      description:
        "List notes that link TO a given note inside a friend's brain — same as get_backlinks, but scoped to a friend. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        friend: z.string().describe("friend slug from list_friends"),
        path: z.string().describe("the note whose backlinks you want, e.g. people/ana.md"),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async ({ friend, path, limit }) => {
      const f = findFriend(await friends(), friend);
      return text(await brain.getBacklinks(f.ownerId, path, allowedVisibilities(f.maxVisibility), limit ?? 50));
    },
  );

  server.registerTool(
    "get_friend_neighbors",
    {
      title: "Get neighboring notes in a friend's brain",
      description:
        "Explore a note's neighborhood in a friend's knowledge graph: `outgoing` links, `backlinks`, and `semantic` (topically similar) notes — same as get_neighbors, but scoped to a friend. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        friend: z.string().describe("friend slug from list_friends"),
        path: z.string().describe("the note to explore, e.g. projects/x/_index.md"),
        semantic_limit: z.number().int().positive().max(15).optional().describe("how many semantic neighbors (default 6)"),
      },
    },
    async ({ friend, path, semantic_limit }) => {
      const f = findFriend(await friends(), friend);
      return text(
        await brain.getNeighbors(f.ownerId, path, allowedVisibilities(f.maxVisibility), {
          semanticLimit: semantic_limit,
        }),
      );
    },
  );

  server.registerTool(
    "search_friend_by_entity",
    {
      title: "Search a friend's brain by entity",
      description:
        "Find everything a friend has shared about a named person, project, or concept: its canonical page plus the notes that mention or link to it — same as search_by_entity, but scoped to a friend. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        friend: z.string().describe("friend slug from list_friends"),
        name: z.string().describe("the person, project, or concept name"),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ friend, name, limit }) => {
      const f = findFriend(await friends(), friend);
      return text(await brain.searchByEntity(f.ownerId, name, allowedVisibilities(f.maxVisibility), { limit }));
    },
  );

  server.registerTool(
    "friend_timeline",
    {
      title: "Timeline of a friend's notes",
      description:
        "List a friend's notes chronologically within an optional date window — same as timeline, but scoped to a friend. Order by `created` (default) or `updated`, filter by type/tag/path prefix. Read-only; capped at the visibility they granted you. Call list_friends first for valid `friend` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        friend: z.string().describe("friend slug from list_friends"),
        from: z.string().optional().describe("inclusive start date YYYY-MM-DD"),
        to: z.string().optional().describe("inclusive end date YYYY-MM-DD"),
        by: z.enum(["created", "updated"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        type: z.string().optional(),
        tags: z.array(z.string()).optional(),
        prefix: z.string().optional().describe("path prefix filter, e.g. journal/"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ friend, from, to, by, order, type, tags, prefix, limit }) => {
      const f = findFriend(await friends(), friend);
      return text(
        await brain.timeline(f.ownerId, {
          allowed: allowedVisibilities(f.maxVisibility),
          from,
          to,
          by,
          order,
          types: type ? [type] : undefined,
          tags,
          prefix,
          limit,
        }),
      );
    },
  );

  // ── Company spaces ────────────────────────────────────────────────────────
  // The personal MCP inherits read access to every company wiki the user is a
  // member of, addressable by a stable `space` slug (see list_spaces). Reads are
  // capped by role: members see public+private; owners/admins see everything up
  // to their own scope. Explicit *_space write tools let owners/admins operate a
  // company wiki from OAuth clients that cannot set X-Brain-Space headers.

  interface SpaceEntry {
    slug: string;
    id: string;
    name: string;
    role: SpaceRole;
    allowed: Visibility[];
  }
  function spaceReadVisibilities(role: SpaceRole): Visibility[] {
    return effectiveAllowedForRole(auth.scope, role, false);
  }
  let _spaces: SpaceEntry[] | null = null;
  async function companySpaces(): Promise<SpaceEntry[]> {
    if (_spaces) return _spaces;
    const list: Space[] = await listSpacesForUser(auth.userId);
    const seen = new Set<string>();
    _spaces = list
      .filter((s) => s.kind === "company")
      .map((s) => {
        const role: SpaceRole = s.role ?? "member";
        let slug = s.slug || slugify(s.name) || "space";
        while (seen.has(slug)) slug = `${slug}-${s.id.slice(0, 4)}`;
        seen.add(slug);
        return { slug, id: s.id, name: s.name, role, allowed: spaceReadVisibilities(role) };
      });
    return _spaces;
  }
  function findSpace(list: SpaceEntry[], slug: string): SpaceEntry {
    const found = list.find((s) => s.slug === slug);
    if (!found) {
      throw new NotFoundError(`no space '${slug}' — call list_spaces to see the wikis you can read`);
    }
    return found;
  }
  function requireCompanyWrite(space: SpaceEntry): void {
    requireWrite();
    if (space.role !== "owner" && space.role !== "admin") {
      throw new ForbiddenError(`role '${space.role}' cannot write to company space '${space.slug}'`);
    }
  }

  server.registerTool(
    "list_spaces",
    {
      title: "List company wikis",
      description:
        "List the company wikis (shared team brains) you're a member of. Returns each space's slug (use it as the `space` argument for the *_space read/write tools), its name, and your role. These are separate from your personal brain and from friends' brains.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () =>
      text((await companySpaces()).map((s) => ({ space: s.slug, name: s.name, role: s.role }))),
  );

  server.registerTool(
    "recall_space",
    {
      title: "Recall from a company wiki",
      description:
        "Recall everything relevant to a topic from a company wiki you belong to — same as recall, but scoped to that space's brain. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        topic: z.string().describe("the topic or question to recall context for"),
        limit: z.number().int().positive().max(20).optional(),
      },
    },
    async ({ space, topic, limit }) => {
      const s = findSpace(await companySpaces(), space);
      return text(await brain.getContext(s.id, topic, s.allowed, limit ?? 6));
    },
  );

  server.registerTool(
    "search_space",
    {
      title: "Search a company wiki",
      description:
        "Full-text search across a company wiki you belong to — same as search_brain, but scoped to that space. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        query: z.string().describe("search terms"),
        types: z.array(z.string()).optional().describe("filter by note types"),
        tags: z.array(z.string()).optional().describe("filter by tags (any match)"),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ space, query, types, tags, limit }) => {
      const s = findSpace(await companySpaces(), space);
      return text(await brain.search(s.id, query, { allowed: s.allowed, types, tags, limit }));
    },
  );

  server.registerTool(
    "list_space_notes",
    {
      title: "List a company wiki's notes",
      description:
        "List notes in a company wiki you belong to, optionally filtered by type and tags — same as list_notes, but scoped to that space. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        type: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ space, type, tags, limit }) => {
      const s = findSpace(await companySpaces(), space);
      return text(
        await brain.listNotes(s.id, { allowed: s.allowed, types: type ? [type] : undefined, tags, limit }),
      );
    },
  );

  server.registerTool(
    "read_space_note",
    {
      title: "Read a company wiki note",
      description:
        "Read the full markdown of one note in a company wiki you belong to by path — same as read_note, but scoped to that space. Embedded media is listed as `oms-asset:` references; pass one to get_media (with the same `space`) to see it. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string().describe("relative note path, e.g. product/spec.md"),
      },
    },
    async ({ space, path }) => {
      const s = findSpace(await companySpaces(), space);
      const note = await brain.readNote(s.id, path, s.allowed);
      return text(await withMediaIndex(s.id, serializeNote(note.meta, note.body)));
    },
  );

  server.registerTool(
    "research_space",
    {
      title: "Research a company wiki (deep)",
      description:
        "DEEP retrieval over a company wiki you belong to — same as research_brain, but scoped to that space. For hard, multi-hop, or synthesis questions about the company ('why did we bet on X?', 'how does the strategy connect to the roadmap?', 'what's the story of Z over time?'). Plans sub-queries, does multiple hybrid searches, follows links, reads the top notes, and returns a synthesized `answer` with cited `sources`, `coverage`, `suggested_followups`, and a `trace`. Slower/costlier — for a single fact use recall_space or search_space. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        question: z.string().describe("the question to research over the company wiki"),
        max_searches: z.number().int().positive().max(8).optional().describe("cap on hybrid searches (default 5)"),
        max_reads: z.number().int().positive().max(15).optional().describe("cap on notes read in full (default 8)"),
      },
    },
    async ({ space, question, max_searches, max_reads }) => {
      const s = findSpace(await companySpaces(), space);
      const res = await researchBrain(brain, s.id, question, s.allowed, {
        maxSearches: max_searches,
        maxReads: max_reads,
      });
      return text(res);
    },
  );

  server.registerTool(
    "get_space_backlinks",
    {
      title: "Get backlinks in a company wiki",
      description:
        "List notes that link TO a given note inside a company wiki — same as get_backlinks, but scoped to that space. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string().describe("the note whose backlinks you want, e.g. strategy/thesis.md"),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async ({ space, path, limit }) => {
      const s = findSpace(await companySpaces(), space);
      return text(await brain.getBacklinks(s.id, path, s.allowed, limit ?? 50));
    },
  );

  server.registerTool(
    "get_space_neighbors",
    {
      title: "Get neighboring notes in a company wiki",
      description:
        "Explore a note's neighborhood in a company wiki's knowledge graph: `outgoing` links, `backlinks`, and `semantic` (topically similar) notes — same as get_neighbors, but scoped to that space. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string().describe("the note to explore, e.g. product/spec.md"),
        semantic_limit: z.number().int().positive().max(15).optional().describe("how many semantic neighbors (default 6)"),
      },
    },
    async ({ space, path, semantic_limit }) => {
      const s = findSpace(await companySpaces(), space);
      return text(await brain.getNeighbors(s.id, path, s.allowed, { semanticLimit: semantic_limit }));
    },
  );

  server.registerTool(
    "search_space_by_entity",
    {
      title: "Search a company wiki by entity",
      description:
        "Find everything a company wiki knows about a named person, project, or concept: its canonical page plus the notes that mention or link to it — same as search_by_entity, but scoped to that space. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        name: z.string().describe("the person, project, or concept name"),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ space, name, limit }) => {
      const s = findSpace(await companySpaces(), space);
      return text(await brain.searchByEntity(s.id, name, s.allowed, { limit }));
    },
  );

  server.registerTool(
    "space_timeline",
    {
      title: "Timeline of a company wiki's notes",
      description:
        "List a company wiki's notes chronologically within an optional date window — same as timeline, but scoped to that space. Order by `created` (default) or `updated`, filter by type/tag/path prefix. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        from: z.string().optional().describe("inclusive start date YYYY-MM-DD"),
        to: z.string().optional().describe("inclusive end date YYYY-MM-DD"),
        by: z.enum(["created", "updated"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        type: z.string().optional(),
        tags: z.array(z.string()).optional(),
        prefix: z.string().optional().describe("path prefix filter, e.g. meetings/"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ space, from, to, by, order, type, tags, prefix, limit }) => {
      const s = findSpace(await companySpaces(), space);
      return text(
        await brain.timeline(s.id, {
          allowed: s.allowed,
          from,
          to,
          by,
          order,
          types: type ? [type] : undefined,
          tags,
          prefix,
          limit,
        }),
      );
    },
  );

  server.registerTool(
    "create_space_note",
    {
      title: "Create a company wiki note",
      description:
        "Create a note inside a company wiki selected by its stable space slug. Requires owner/admin role and a writable connection. Never writes to the personal brain. Specs, PRDs and plans are gated: the first call returns a draft preview to show the owner, and only a second call carrying the returned `confirm_token` actually writes.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        type: z.string().describe("note type from the company taxonomy"),
        title: z.string(),
        body: z.string().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        path: z.string().optional(),
        confirm_token: confirmTokenSchema,
      },
    },
    async ({ space, confirm_token, ...args }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      if (args.visibility && !s.allowed.includes(args.visibility)) {
        throw new ForbiddenError("cannot create a company note above your scope");
      }
      const cfg = await getUserConfig(s.id);
      const pending = await gateWorkDoc({
        spaceId: s.id,
        space: s.slug,
        path: derivedPath(cfg, args.type, args.title, args.path),
        title: args.title,
        body: args.body,
        type: args.type,
        visibility: args.visibility,
        scope: s.allowed,
        confirmToken: confirm_token,
      });
      if (pending) return text(pending);
      const note = await brain.createNote(s.id, args, cfg, s.allowed, mcpAttr(`create ${args.title}`));
      return text(withUrl({ space: s.slug, created: note.path, meta: note.meta }, s.id));
    },
  );

  server.registerTool(
    "update_space_note",
    {
      title: "Update a company wiki note",
      description:
        "Update a note's body and/or frontmatter inside a company wiki. Requires owner/admin role and a writable connection. Rewriting a spec, PRD or plan is gated: the first call returns a draft preview to show the owner, and only a second call carrying the returned `confirm_token` actually writes.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string(),
        body: z.string().optional(),
        title: z.string().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        confirm_token: confirmTokenSchema,
      },
    },
    async ({ space, path, confirm_token, ...patch }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      if (patch.visibility && !s.allowed.includes(patch.visibility)) {
        throw new ForbiddenError("cannot update a company note above your scope");
      }
      const pending = await gateWorkDoc({
        spaceId: s.id,
        space: s.slug,
        path,
        title: patch.title,
        body: patch.body,
        visibility: patch.visibility,
        scope: s.allowed,
        confirmToken: confirm_token,
      });
      if (pending) return text(pending);
      const note = await brain.updateNote(s.id, path, patch, s.allowed, mcpAttr(`update ${path}`));
      return text(withUrl({ space: s.slug, updated: note.path, meta: note.meta }, s.id));
    },
  );

  server.registerTool(
    "append_space_note",
    {
      title: "Append to a company wiki note",
      description:
        "Append text to a note inside a company wiki. Requires owner/admin role and a writable connection. Appending a substantial section to a spec, PRD or plan is gated: the first call returns a draft preview to show the owner, and only a second call carrying the returned `confirm_token` actually writes.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string(),
        text: z.string(),
        confirm_token: confirmTokenSchema,
      },
    },
    async ({ space, path, text: content, confirm_token }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      const pending = await gateWorkDoc({
        spaceId: s.id,
        space: s.slug,
        path,
        body: content,
        append: true,
        scope: s.allowed,
        confirmToken: confirm_token,
      });
      if (pending) return text(pending);
      const note = await brain.appendToNote(s.id, path, content, s.allowed, mcpAttr(`append ${path}`));
      return text(withUrl({ space: s.slug, appended: note.path }, s.id));
    },
  );

  server.registerTool(
    "move_space_note",
    {
      title: "Move or rename a company wiki note",
      description:
        "Move a note to a new path inside a company wiki, preserving its frontmatter, version history and comment threads. Use this to reorganize the wiki (e.g. into a pillar's specs/ folder) instead of recreating the note and leaving a redirect behind. Refuses a destination whose top-level folder doesn't exist in the space yet, so a typo can't invent a pillar — pass `allow_new_folder` when you really mean to create one. Returns `broken_backlinks`: notes that still link to the OLD path and need rewriting. Requires owner/admin role.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        from: z.string().describe("current note path"),
        to: z.string().describe("destination path, must end in .md"),
        summary: z.string().max(80).optional().describe("why, shown on the timeline"),
        allow_new_folder: z
          .boolean()
          .optional()
          .describe("permit a destination in a top-level folder the space doesn't have yet"),
      },
    },
    async ({ space, from, to, summary, allow_new_folder }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      const cfg = await getUserConfig(s.id);
      if (!allow_new_folder) {
        const top = to.trim().replace(/^\/+/, "").split("/")[0] ?? "";
        const existing = new Set(cfg.noteTypes.map((t) => t.folder));
        for (const n of await brain.listNotes(s.id, { allowed: s.allowed, limit: 500 })) {
          const seg = n.path.split("/")[0];
          if (seg && n.path.includes("/")) existing.add(seg);
        }
        if (!existing.has(top)) {
          throw new BadRequestError(
            `"${top}/" is not a folder in this space. Existing: ${[...existing].sort().join(", ")}. ` +
              `Pass allow_new_folder:true to create it.`,
          );
        }
      }
      // Read the incoming links before the move: they keep pointing at the old
      // path, and the caller needs the list to repair them.
      const backlinks = await brain
        .getBacklinks(s.id, from, s.allowed, 50)
        .catch(() => [] as { path: string }[]);
      const note = await brain.moveNote(s.id, from, to, s.allowed, mcpAttr(summary), cfg);
      return text(
        withUrl(
          {
            space: s.slug,
            moved: from,
            to: note.path,
            broken_backlinks: backlinks.map((b) => b.path),
          },
          s.id,
        ),
      );
    },
  );

  server.registerTool(
    "delete_space_note",
    {
      title: "Delete a company wiki note",
      description:
        "Permanently remove a note from a company wiki. Gated: the first call deletes nothing and reports what would be lost plus which notes link to it (`breaks_backlinks`), with a `confirm_token`; only a second call carrying that token removes it. Use it to retire dead redirects and superseded stubs once their backlinks reach zero. Requires owner/admin role.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string(),
        confirm_token: z
          .string()
          .optional()
          .describe("the token from this tool's preview, sent back after the owner approved the deletion"),
      },
    },
    async ({ space, path, confirm_token }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      const note = await brain.readNote(s.id, path, s.allowed);
      const backlinks = await brain
        .getBacklinks(s.id, path, s.allowed, 50)
        .catch(() => [] as { path: string }[]);
      const pending = reviewDelete({
        spaceId: s.id,
        space: s.slug,
        path,
        title: note.meta.title,
        type: note.meta.type,
        body: note.body,
        backlinks: backlinks.map((b) => b.path),
        confirmToken: confirm_token,
      });
      if (pending) return text(pending);
      await brain.deleteNote(s.id, path, s.allowed, mcpAttr(`delete ${path}`));
      return text({ space: s.slug, deleted: path });
    },
  );

  server.registerTool(
    "link_space_notes",
    {
      title: "Link two company wiki notes",
      description:
        "Create a bidirectional link between two notes in the same company wiki. Requires owner/admin role and a writable connection.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        a: z.string(),
        b: z.string(),
      },
    },
    async ({ space, a, b }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      await brain.linkNotes(s.id, a, b, s.allowed);
      return text({ space: s.slug, linked: [a, b] });
    },
  );

  server.registerTool(
    "save_space_skill",
    {
      title: "Save a company skill",
      description:
        "Save or update a reusable skill inside a company wiki's Skills category. Requires owner/admin role and a writable connection. The skill is never stored in the personal brain.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        name: z.string().describe("short skill name, e.g. 'Bonds weekly'"),
        description: z.string().describe("when to use this skill (one sentence)"),
        instructions: z.string().describe("the full instructions / steps in markdown"),
        tags: z.array(z.string()).optional(),
        visibility: VisibilityEnum.optional(),
      },
    },
    async ({ space, name, description, instructions, tags, visibility }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      if (visibility && !s.allowed.includes(visibility)) {
        throw new ForbiddenError("cannot save a company skill above your scope");
      }
      const body = `> ${description.trim()}\n\n${instructions.trim()}`;
      const { note, created } = await brain.upsertNote(
        s.id,
        skillPath(name),
        {
          type: "skill",
          title: name,
          body,
          visibility,
          tags: ["skill", ...(tags ?? [])],
        },
        await getUserConfig(s.id),
        s.allowed,
      );
      return text(
        withUrl(
          {
            ok: true,
            space: s.slug,
            path: note.path,
            created,
            visibility: note.meta.visibility,
          },
          s.id,
        ),
      );
    },
  );

  server.registerTool(
    "write_space",
    {
      title: "Save to a company wiki (auto-routed)",
      description:
        "Capture durable info into a company wiki without deciding WHERE it goes — same as write_brain, but scoped to that space. The router classifies it, dedupes against existing notes, and writes it to the right place. Returns the resolved `path`, `category`, `operation`, and `related` (possible duplicates). Prefer the specific space tools (create_space_note / update_space_note / append_space_note) when you know the destination. Requires owner/admin role and a writable connection. Pass `apply=false` to preview the routing without writing. Never writes to the personal brain.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        content: z.string().describe("the info to save, phrased as a standalone statement"),
        hint: z.string().optional().describe("optional nudge about where it belongs"),
        apply: z.boolean().optional().describe("default true; false = preview routing only"),
        visibility: VisibilityEnum.optional().describe("override; defaults to the router's choice"),
      },
    },
    async ({ space, content, hint, apply, visibility }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      if (visibility && !s.allowed.includes(visibility)) {
        throw new ForbiddenError("cannot write to a company space above your scope");
      }
      const res = await writeBrain(brain, s.id, content, await getUserConfig(s.id), s.allowed, {
        hint,
        apply,
        visibility,
      });
      return text(withUrl(res, s.id));
    },
  );

  // ── Customize the taxonomy (level-1 categories) ───────────────────────────

  server.registerTool(
    "upsert_category",
    {
      title: "Create or update a top-level category",
      description:
        "Create or update a level-1 category (note type) in the taxonomy — e.g. add a new 'Social media' category, or rename/refile an existing one. This is how the person customizes the TOP level of their brain. Call get_structure first to see current categories and ids. Existing notes are not moved; this only changes the category definition.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        name: z.string().describe("display label, e.g. 'Social media'"),
        id: z
          .string()
          .optional()
          .describe("stable id/slug; defaults to a slug of the name. Pass an existing id to UPDATE that category."),
        folder: z
          .string()
          .optional()
          .describe("folder its notes live in; defaults to a slug of the id/name"),
        defaultVisibility: VisibilityEnum.optional().describe(
          "default visibility for notes in this category; defaults to 'private'",
        ),
      },
    },
    async ({ name, id, folder, defaultVisibility }) => {
      requireWrite();
      const current = await config();
      const catId = slugify(id ?? name);
      if (!catId) throw new ForbiddenError("a category needs a non-empty name or id");
      const noteTypes = [...current.noteTypes];
      const idx = noteTypes.findIndex((t) => t.id === catId);
      const existing = idx >= 0 ? noteTypes[idx] : undefined;
      const next: NoteType = {
        id: catId,
        label: name.trim() || catId,
        folder: slugify(folder ?? catId),
        defaultVisibility: defaultVisibility ?? existing?.defaultVisibility ?? "private",
      };
      const created = !existing;
      if (created) noteTypes.push(next);
      else noteTypes[idx] = next;
      _config = await setUserConfig(auth.spaceId, { ...current, noteTypes });
      return text({ ok: true, created, category: next, categories: _config.noteTypes });
    },
  );

  server.registerTool(
    "remove_category",
    {
      title: "Remove a top-level category",
      description:
        "Remove a level-1 category (note type) from the taxonomy by id. Existing notes/files are left untouched — only the category definition goes away. The taxonomy must keep at least one category. Call get_structure first to find the id.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: { id: z.string().describe("the category id to remove (see get_structure)") },
    },
    async ({ id }) => {
      requireWrite();
      const current = await config();
      const catId = slugify(id);
      const noteTypes = current.noteTypes.filter((t) => t.id !== catId);
      if (noteTypes.length === current.noteTypes.length) {
        return text({ ok: false, error: `no category with id '${catId}'`, categories: current.noteTypes });
      }
      if (noteTypes.length === 0) {
        throw new ForbiddenError("cannot remove the last category; the taxonomy needs at least one");
      }
      _config = await setUserConfig(auth.spaceId, { ...current, noteTypes });
      return text({ ok: true, removed: catId, categories: _config.noteTypes });
    },
  );

  // ── Maintain the second self (high-level writes) ───────────────────────────

  server.registerTool(
    "remember",
    {
      title: "Save a memory",
      description:
        "Persist a durable fact, preference, or insight you learned about the person. Appends a dated, tagged bullet to memory/log.md so it's never lost. Use this liberally during conversation.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: {
        text: z.string().describe("the fact or insight, phrased as a standalone statement"),
        tags: z.array(z.string()).optional(),
        visibility: VisibilityEnum.optional().describe("defaults to private"),
      },
    },
    async ({ text: t, tags, visibility }) => {
      const line = `- ${todayISO()} — ${t.trim()}${tags?.length ? ` _(${tags.map((x) => `#${x}`).join(" ")})_` : ""}`;
      const res = await upsert("memory/log.md", {
        type: "note",
        title: "Memory log",
        body: line,
        append: true,
        visibility: visibility ?? "private",
        tags: ["memory", ...(tags ?? [])],
      });
      return text(withUrl({ ...res, remembered: t.trim() }));
    },
  );

  server.registerTool(
    "update_identity",
    {
      title: "Update identity",
      description:
        "Create or update a fact about who the person is. Default target is identity/about-me.md; pass `facet` to maintain a separate page (e.g. 'values', 'bio', 'health'). Replaces the body unless `append` is true.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        body: z.string().describe("the identity content in markdown"),
        facet: z.string().optional().describe("a named identity page, e.g. 'values'"),
        append: z.boolean().optional(),
        visibility: VisibilityEnum.optional(),
      },
    },
    async ({ body, facet, append, visibility }) => {
      const slug = facet ? slugify(facet) : "about-me";
      const res = await upsert(`identity/${slug}.md`, {
        type: "identity",
        title: facet ? facet : "About me",
        body,
        append,
        visibility,
      });
      return text(withUrl(res));
    },
  );

  server.registerTool(
    "set_goal",
    {
      title: "Set a goal",
      description:
        "Create or update goals for a period. `period` accepts a year ('2026'), a quarter ('2026-q3'), or a month ('2026-06').",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        period: z.string().describe("'2026', '2026-q3', or '2026-06'"),
        body: z.string().describe("the goals in markdown (e.g. a checklist)"),
        title: z.string().optional(),
        append: z.boolean().optional(),
        visibility: VisibilityEnum.optional(),
      },
    },
    async ({ period, body, title, append, visibility }) => {
      const res = await upsert(goalPath(period), {
        type: "goal",
        title: title ?? `Goals ${period}`,
        body,
        append,
        visibility,
      });
      return text(withUrl(res));
    },
  );

  server.registerTool(
    "upsert_project",
    {
      title: "Create or update a project",
      description:
        "Create or update a project's overview at projects/<slug>/_index.md. Use this to set the summary, status, and tags. For sub-documents (PRDs, specs, transcripts) or sub-projects use add_to_project.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        name: z.string(),
        summary: z.string().optional().describe("markdown overview; replaces the body unless append=true"),
        status: z.string().optional().describe("e.g. active, paused, shipped"),
        tags: z.array(z.string()).optional(),
        append: z.boolean().optional(),
        visibility: VisibilityEnum.optional(),
      },
    },
    async ({ name, summary, status, tags, append, visibility }) => {
      requireWrite();
      const res = await upsertProject(brain, auth.spaceId, await config(), allowed, {
        name,
        summary,
        status,
        tags,
        append,
        visibility,
      });
      return text(withUrl(res));
    },
  );

  server.registerTool(
    "add_to_project",
    {
      title: "Add a document to a project",
      description:
        "Add or update a document inside a project: a PRD, spec, meeting transcript, note, or a nested sub-project. Path is derived from the project + kind + title. PRDs and specs are gated: the first call returns a draft preview to show the owner, and only a second call carrying the returned `confirm_token` actually writes.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        project: z.string().describe("the parent project name"),
        kind: z.enum(["prd", "spec", "transcript", "note", "subproject"]),
        title: z.string(),
        body: z.string().optional(),
        append: z.boolean().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
        confirm_token: confirmTokenSchema,
      },
    },
    async ({ project, kind, title, body, append, visibility, tags, confirm_token }) => {
      requireWrite();
      const pending = await gateWorkDoc({
        spaceId: auth.spaceId,
        path: projectDocPath(project, kind as ProjectKind, title),
        title,
        body,
        type: kind,
        append,
        visibility,
        confirmToken: confirm_token,
      });
      if (pending) return text(pending);
      const res = await addToProject(brain, auth.spaceId, await config(), allowed, {
        project,
        kind: kind as ProjectKind,
        title,
        body,
        append,
        visibility,
        tags,
      });
      return text(withUrl(res));
    },
  );

  server.registerTool(
    "add_person",
    {
      title: "Add or update a person",
      description:
        "Create or update someone in the person's life at people/<slug>.md — relationship, how you know them, and notes.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        name: z.string(),
        relationship: z.string().optional().describe("e.g. friend, cofounder, sister"),
        notes: z.string().optional().describe("markdown notes about them"),
        append: z.boolean().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ name, relationship, notes, append, visibility, tags }) => {
      requireWrite();
      const res = await upsertPerson(brain, auth.spaceId, await config(), allowed, {
        name,
        relationship,
        notes,
        append,
        visibility,
        tags,
      });
      return text(withUrl(res));
    },
  );

  server.registerTool(
    "profile_person",
    {
      title: "Profile a person (synthesized read)",
      description:
        "Synthesize a durable 'Read' of a person (how they are, how to work with them) from the dated facts on their page, and write it near the top of people/<slug>.md. Idempotent — regenerates the read as facts grow. Pass person to profile one; omit it to refresh everyone whose read is stale.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        person: z.string().optional().describe("name or slug; omit to refresh all stale people"),
        minFacts: z.number().optional().describe("min dated facts required (default 3)"),
        limit: z.number().optional().describe("when refreshing all, cap regenerations (default 40)"),
        force: z.boolean().optional().describe("regenerate even if unchanged"),
      },
    },
    async ({ person, minFacts, limit, force }) => {
      requireWrite();
      if (person) {
        const r = await profilePerson(brain, auth.spaceId, await config(), allowed, person, {
          minFacts,
          force,
        });
        return text(r);
      }
      const r = await profileStalePeople(brain, auth.spaceId, await config(), allowed, {
        minFacts,
        force,
        limit: limit ?? 40,
      });
      return text(r);
    },
  );

  server.registerTool(
    "log_journal",
    {
      title: "Log a journal entry",
      description:
        "Append a dated journal entry to journal/<year>/<date>.md (creates the day if needed). Great for daily reflections.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: {
        entry: z.string().describe("the journal entry in markdown"),
        date: z.string().optional().describe("ISO date YYYY-MM-DD; defaults to today"),
        visibility: VisibilityEnum.optional(),
      },
    },
    async ({ entry, date, visibility }) => {
      const day = (date ?? todayISO()).slice(0, 10);
      const year = day.slice(0, 4);
      const res = await upsert(`journal/${year}/${day}.md`, {
        type: "journal",
        title: day,
        body: entry,
        append: true,
        visibility,
      });
      return text(withUrl(res));
    },
  );

  server.registerTool(
    "add_todo",
    {
      title: "Add a to-do",
      description:
        "DEPRECATED (contract v2): tasks do not belong in the brain. Capture tasks in the user's task manager (Flowya) instead — the brain is durable context only (identity, people, projects, decisions). Kept as a compatibility shim; still appends a checkbox to todos/<list>.md, but new integrations must not use it.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: {
        item: z.string(),
        list: z.string().optional().describe("list name, e.g. 'life' or a project slug"),
        visibility: VisibilityEnum.optional(),
      },
    },
    async ({ item, list, visibility }) => {
      const res = await upsert(`todos/${slugify(list ?? "life")}.md`, {
        type: "todo",
        title: `${list ?? "life"} to-dos`,
        body: `- [ ] ${item.trim()}`,
        append: true,
        visibility,
      });
      return text(res);
    },
  );

  // ── Meeting Intelligence (ingest + query) ─────────────────────────────────

  server.registerTool(
    "ingest_source",
    {
      title: "Ingest a source into the wiki",
      description:
        "Distill a raw source (a meeting transcript, workshop notes, a pasted doc) into the brain: person facts, project updates, commitments, a short meeting note, and reconciliation of open commitments. The raw text is NOT stored — only the distilled signal, with an optional link back to the source. Use this for Atlas workshops, Granola pastes, or any transcript.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: {
        content: z.string().describe("the raw source text to distill"),
        kind: z
          .enum(["meeting", "workshop", "note"])
          .optional()
          .describe("what kind of source this is (default: meeting)"),
        title: z.string().optional(),
        date: z.string().optional().describe("ISO date of the source"),
        sourceUrl: z.string().optional().describe("link back to the immutable source"),
        mode: z
          .enum(["light", "full"])
          .optional()
          .describe("light = person facts + concepts only (historical backfill); full = everything"),
        visibility: VisibilityEnum.optional(),
      },
    },
    async ({ content, kind, title, date, sourceUrl, mode, visibility }) => {
      requireWrite();
      if (!distillEnabled()) {
        return text("Ingest needs OPENAI_API_KEY configured on the server.");
      }
      const res = await ingest(brain, auth.spaceId, await config(), allowed, {
        kind: kind ?? "meeting",
        rawText: content,
        title,
        date,
        sourceUrl,
        mode: mode ?? "full",
        visibility,
      });
      return text({
        isNoise: res.isNoise,
        meetingPath: res.meetingPath,
        touched: res.touched,
        commitments: res.commitments,
        resolved: res.resolved,
      });
    },
  );

  server.registerTool(
    "list_meetings",
    {
      title: "List meeting notes",
      description:
        "List distilled meeting notes, most recent meeting first (ordered by the meeting's own date, not when it was ingested). These are the summaries produced by ingest_source / the Drive connector, not raw transcripts. To answer 'what meetings were there yesterday/on a date?', pass `date` (YYYY-MM-DD) to get ALL meetings for that day; or pass `since`/`until` for a range. Without a date filter it returns the N most recent meetings.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        limit: z.number().int().positive().max(200).optional(),
        date: z.string().optional().describe("YYYY-MM-DD — return every meeting on exactly this day"),
        since: z.string().optional().describe("YYYY-MM-DD — only meetings on/after this day"),
        until: z.string().optional().describe("YYYY-MM-DD — only meetings on/before this day"),
      },
    },
    async ({ limit, date, since, until }) => {
      // Meeting date is encoded in the path (meetings/YYYY-MM-DD-slug.md), while
      // the `updated` timestamp reflects (re)ingestion. Filtering by an exact day
      // via a path prefix returns *all* of that day's meetings regardless of how
      // recently each was touched; otherwise we sort by path (≈ meeting date) so
      // "most recent" means most recent meeting, not most recently reprocessed.
      const prefix = date ? `meetings/${date}` : "meetings/";
      let rows = await brain.listNotes(auth.spaceId, {
        types: ["meeting"],
        prefix,
        allowed,
        limit: 1000,
      });
      const dayOf = (p: string) => p.slice("meetings/".length, "meetings/".length + 10);
      if (since) rows = rows.filter((r) => dayOf(r.path) >= since);
      if (until) rows = rows.filter((r) => dayOf(r.path) <= until);
      rows.sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
      if (!date && !since && !until) rows = rows.slice(0, limit ?? 25);
      return text(rows);
    },
  );

  server.registerTool(
    "list_action_items",
    {
      title: "List commitments / action items",
      description:
        "List meeting-derived commitments, filtered by owner ('me' or a person) and status (open/resolved/dropped). Owner=me + status=open is your 'to capture in Flowya' list; owner=other is your 'waiting on' list. These are context, not Flowya tasks.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        owner: z.string().optional().describe("'me' or a person name/slug"),
        status: z.enum(["open", "resolved", "dropped"]).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ owner, status, limit }) => {
      const rows = await listCommitments(brain, auth.spaceId, {
        owner: owner as CommitmentOwner | undefined,
        status: status as CommitmentStatus | undefined,
        allowed,
        limit,
      });
      return text(rows);
    },
  );

  server.registerTool(
    "update_action_item",
    {
      title: "Update a commitment / action item",
      description:
        "Update a meeting-derived commitment: mark it resolved/dropped, and/or link it to the Flowya task it became. Use this after capturing an owner=me commitment into Flowya (pass its flowyaTaskId), or when a source confirms a commitment is done. Keeps the wiki in sync with Flowya.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        path: z.string().describe("the commitment note path (from list_action_items)"),
        status: z.enum(["open", "resolved", "dropped"]).optional(),
        flowyaTaskId: z.string().optional().describe("the Flowya task id this commitment became"),
        reason: z.string().optional().describe("short note on why it was resolved/dropped"),
      },
    },
    async ({ path, status, flowyaTaskId, reason }) => {
      requireWrite();
      if (flowyaTaskId) await stampFlowyaTaskId(brain, auth.spaceId, allowed, path, flowyaTaskId);
      if (status) await setCommitmentStatus(brain, auth.spaceId, allowed, path, status, { reason });
      return text({ ok: true, path, status, flowyaTaskId });
    },
  );

  // ── Wiki-lint review (Karpathy's Lint op, human-in-the-loop) ───────────────

  server.registerTool(
    "get_lint_report",
    {
      title: "Get the latest wiki-lint report",
      description:
        "Read the most recent wiki-lint report (or a specific dated one). The server's periodic lint auto-applies high-confidence mechanical fixes and PROPOSES the judgment calls (ambiguous merges, concept culls, rehomes, orphan/thin flags). Use this in a weekly review to surface those proposals, then apply the approved ones with apply_lint.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        date: z.string().optional().describe("YYYY-MM-DD; omit for the latest report"),
      },
    },
    async ({ date }) => {
      return text(await getLintReport(auth.spaceId, allowed, date));
    },
  );

  server.registerTool(
    "apply_lint",
    {
      title: "Apply an approved wiki-lint proposal",
      description:
        "Apply ONE proposal from a lint report after JD approves it — merge (fold `drop` into `keep`, facts preserved + inbound links repointed), cull (demote a non-glossary concept to a plain note, content kept), or rehome (move a misfiled note to its real pillar). Runs the server's tested non-destructive path; do NOT reimplement merges by hand. For merge, pass keep+drop; for cull, pass path; for rehome, pass from+home (and optional title).",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      inputSchema: {
        op: z.enum(["merge", "cull", "rehome"]),
        keep: z.string().optional().describe("merge: the surviving note path"),
        drop: z.string().optional().describe("merge: the note path to fold in and delete"),
        path: z.string().optional().describe("cull: the concept note path to demote"),
        from: z.string().optional().describe("rehome: the misfiled note path"),
        home: z.enum(["person", "project", "concept", "note"]).optional().describe("rehome: destination pillar"),
        title: z.string().optional().describe("rehome: override the destination title (optional)"),
      },
    },
    async ({ op, keep, drop, path, from, home, title }) => {
      requireWrite();
      if (op === "merge") {
        if (!keep || !drop) throw new ForbiddenError("merge requires both keep and drop");
        return text(await applyLintMerge(auth.spaceId, keep, drop, allowed));
      }
      if (op === "cull") {
        if (!path) throw new ForbiddenError("cull requires path");
        return text(await applyLintCull(auth.spaceId, path, allowed));
      }
      if (!from || !home) throw new ForbiddenError("rehome requires from and home");
      return text(await applyLintRehome(auth.spaceId, from, home, allowed, title));
    },
  );

  // ── Power tools (generic CRUD) ─────────────────────────────────────────────

  function mcpAttr(summary?: string) {
    return attributionFromAuth(auth, summary);
  }

  server.registerTool(
    "history",
    {
      title: "Note version history",
      description:
        "Version timeline for a note (stored in Supabase). Each entry has a numeric `version` id to pass to restore_version.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z.string().describe("note path"),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ path, limit, offset }) => {
      const entries = await brain.getNoteHistory(auth.spaceId, path, allowed, { limit, offset });
      return text({ path, entries });
    },
  );

  server.registerTool(
    "restore_version",
    {
      title: "Restore note version",
      description:
        "Restore a note to a historical version (id from history). Writes vault + Postgres version row; emits live SSE.",
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: {
        path: z.string(),
        version: z.string().describe("version id from history"),
        summary: z.string().max(80).optional().describe("intent shown on the timeline"),
      },
    },
    async ({ path, version, summary }) => {
      requireWrite();
      const note = await brain.restoreVersion(auth.spaceId, path, version, allowed, mcpAttr(summary));
      return text({ restored: note.path, version, meta: note.meta });
    },
  );

  server.registerTool(
    "activity",
    {
      title: "Recent brain activity",
      description:
        "Space-wide version timeline (newest first): who changed what note, when, and why. Complements per-note history.",
      annotations: { readOnlyHint: true },
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    },
    async ({ limit }) => {
      const entries = await brain.getRecentActivity(auth.spaceId, allowed, { limit });
      return text({ entries });
    },
  );

  server.registerTool(
    "palette",
    {
      title: "Embed & block palette",
      description:
        "Markdown starters and component schemas for rich blocks (callout, mermaid, html preview). Use `components: true` for prop schemas + theme tokens; pass snippets to append_to_note / update_note.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().optional().describe("filter by name/tag"),
        limit: z.number().int().min(1).max(50).optional(),
        components: z
          .union([z.boolean(), z.array(z.string())])
          .optional()
          .describe("true = all component schemas + theme; or filter by component ids"),
      },
    },
    async ({ query, limit, components }) => {
      return text(
        buildPaletteResponse({
          query,
          limit: limit ?? 20,
          components: components === undefined ? false : components,
        }),
      );
    },
  );

  server.registerTool(
    "preview_url",
    {
      title: "Web preview URL",
      description:
        "Return a deep link to open a note in www.ohmyself.ai after writing — useful to verify callout/mermaid/html embed renders.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z.string().describe("note path in the active space"),
      },
    },
    async ({ path }) => {
      return text({
        url: buildPreviewUrl(path, auth.spaceId),
        path,
        space_id: auth.spaceId,
      });
    },
  );

  server.registerTool(
    "link_context",
    {
      title: "Link graph context",
      description:
        "Outgoing links, backlinks, semantic link suggestions, and orphan/hub flags for a note — use before suggesting wiki-links or restructuring docs.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z.string().describe("note path"),
        semantic_limit: z.number().int().min(0).max(20).optional(),
      },
    },
    async ({ path, semantic_limit }) => {
      const ctx = await getLinkContext(brain, auth.spaceId, path, allowed, {
        semanticLimit: semantic_limit ?? 5,
      });
      return text(ctx);
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description:
        "Create a new markdown note. Path is derived from type+title unless provided. Prefer the high-level tools (update_identity, upsert_project, …) when they fit. Specs, PRDs and plans are gated: the first call returns a draft preview to show the owner, and only a second call carrying the returned `confirm_token` actually writes.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        type: z.string().describe("note type (identity, goal, project, person, journal, ...)"),
        title: z.string(),
        body: z.string().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        path: z.string().optional(),
        summary: z.string().max(80).optional().describe("intent shown on the timeline"),
        confirm_token: confirmTokenSchema,
      },
    },
    async (args) => {
      requireWrite();
      if (args.visibility && !allowed.includes(args.visibility)) {
        throw new ForbiddenError("cannot create a note above your scope");
      }
      const { summary, confirm_token, ...input } = args;
      const cfg = await config();
      const pending = await gateWorkDoc({
        spaceId: auth.spaceId,
        path: derivedPath(cfg, input.type, input.title, input.path),
        title: input.title,
        body: input.body,
        type: input.type,
        visibility: input.visibility,
        confirmToken: confirm_token,
      });
      if (pending) return text(pending);
      // Pass `allowed` so a note can't exceed scope via its type's default visibility.
      const note = await brain.createNote(auth.spaceId, input, cfg, allowed, mcpAttr(summary));
      return text(withUrl({ created: note.path, meta: note.meta }));
    },
  );

  server.registerTool(
    "update_note",
    {
      title: "Update a note",
      description:
        "Update a note's body and/or frontmatter by path. Requires a writable scope. Rewriting a spec, PRD or plan is gated: the first call returns a draft preview to show the owner, and only a second call carrying the returned `confirm_token` actually writes.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        path: z.string(),
        body: z.string().optional(),
        title: z.string().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        summary: z.string().max(80).optional().describe("intent shown on the timeline"),
        confirm_token: confirmTokenSchema,
      },
    },
    async ({ path, summary, confirm_token, ...patch }) => {
      requireWrite();
      const pending = await gateWorkDoc({
        spaceId: auth.spaceId,
        path,
        title: patch.title,
        body: patch.body,
        visibility: patch.visibility,
        confirmToken: confirm_token,
      });
      if (pending) return text(pending);
      const note = await brain.updateNote(auth.spaceId, path, patch, allowed, mcpAttr(summary));
      return text(withUrl({ updated: note.path, meta: note.meta }));
    },
  );

  server.registerTool(
    "append_to_note",
    {
      title: "Append to a note",
      description:
        "Append text to the end of a note's body by path. Appending a substantial section to a spec, PRD or plan is gated: the first call returns a draft preview to show the owner, and only a second call carrying the returned `confirm_token` actually writes.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        path: z.string(),
        text: z.string(),
        summary: z.string().max(80).optional(),
        confirm_token: confirmTokenSchema,
      },
    },
    async ({ path, text: t, summary, confirm_token }) => {
      requireWrite();
      const pending = await gateWorkDoc({
        spaceId: auth.spaceId,
        path,
        body: t,
        append: true,
        confirmToken: confirm_token,
      });
      if (pending) return text(pending);
      const note = await brain.appendToNote(auth.spaceId, path, t, allowed, mcpAttr(summary));
      return text(withUrl({ appended: note.path }));
    },
  );

  server.registerTool(
    "link_notes",
    {
      title: "Link two notes",
      description: "Create a bidirectional link between two notes by path.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: { a: z.string(), b: z.string() },
    },
    async ({ a, b }) => {
      requireWrite();
      await brain.linkNotes(auth.spaceId, a, b, allowed);
      return text({ linked: [a, b] });
    },
  );

  server.registerTool(
    "write_brain",
    {
      title: "Save to brain (auto-routed)",
      description:
        "Capture a piece of durable info without deciding WHERE it goes — the router classifies it (memory, identity, a person, a project, a goal period, a journal day, or a note), dedupes against existing notes, and writes it to the right place. Returns the resolved `path`, `category`, `operation`, and `related` (possible duplicates). Prefer the specific tools (remember/add_person/upsert_project/set_goal/log_journal/update_identity) when you already know the destination; use this when you don't. Pass `apply=false` to preview the routing without writing.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: {
        content: z.string().describe("the info to save, phrased as a standalone statement"),
        hint: z.string().optional().describe("optional nudge about where it belongs"),
        apply: z.boolean().optional().describe("default true; false = preview routing only"),
        visibility: VisibilityEnum.optional().describe("override; defaults to the router's choice"),
      },
    },
    async ({ content, hint, apply, visibility }) => {
      requireWrite();
      const res = await writeBrain(brain, auth.spaceId, content, await config(), allowed, {
        hint,
        apply,
        visibility,
      });
      return text(withUrl(res));
    },
  );

  // ── Comments (multiplayer: agents and humans in the same threads) ─────────
  // Comments live beside the note, never inside its markdown, and anchor to a
  // quoted span so they survive edits. Commenting is looser than editing: any
  // member of a space may comment on a note they can read.

  /** Name the comment after the connected client ("Claude", "Cursor", ...). */
  function agentLabel(): string {
    try {
      const client = server.server.getClientVersion();
      if (client?.name) return client.name;
    } catch {
      /* client info is only available after initialize */
    }
    return `agent:${auth.via ?? "token"}`;
  }
  function mcpActor(role: SpaceRole = auth.role): CommentActor {
    return {
      userId: auth.userId,
      kind: "agent",
      label: agentLabel(),
      isAdmin: role === "owner" || role === "admin",
    };
  }
  /** Compact thread shape — anchors and ids in full are noise for a model. */
  function threadOut(t: CommentThread) {
    return {
      thread_id: t.id,
      path: t.path,
      quote: t.anchor?.quote ?? null,
      ...(t.orphaned ? { orphaned: true as const } : {}),
      resolved: Boolean(t.resolvedAt),
      comments: [t.root, ...t.replies].map((c) => ({
        id: c.id,
        author: c.author.label,
        kind: c.author.kind,
        at: c.createdAt,
        body: c.body,
      })),
    };
  }

  server.registerTool(
    "list_comments",
    {
      title: "List comments",
      description:
        "Read the comment threads on a note (pass `path`), or — with no path — every unresolved thread across the brain, i.e. what still needs attention. Each thread shows the quoted text it's anchored to, who said what (human or agent), and whether it's resolved. `orphaned: true` means the quoted text no longer exists in the note.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z.string().optional().describe("note path; omit for all open threads in the brain"),
        include_resolved: z.boolean().optional().describe("default false"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ path, include_resolved, limit }) => {
      const threads = path
        ? await listCommentThreads(brain, auth.spaceId, path, allowed, {
            includeResolved: include_resolved,
          })
        : await listOpenThreads(auth.spaceId, allowed, { limit });
      return text(threads.map(threadOut));
    },
  );

  server.registerTool(
    "add_comment",
    {
      title: "Comment on a note",
      description:
        "Leave a comment on a note — the multiplayer channel between you and the person (and any other agent working the same note). Pass `quote` with text copied EXACTLY from the note to anchor the comment to that span (it shows as a highlight in the app); omit it for a comment about the note as a whole. Use `reply_to` with a comment id from list_comments to answer an existing thread instead of starting a new one. Comments never modify the note's content.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        path: z.string().describe("note path, e.g. projects/x/_index.md"),
        body: z.string().describe("the comment text"),
        quote: z
          .string()
          .optional()
          .describe("exact text from the note to anchor to; must appear verbatim"),
        reply_to: z.string().optional().describe("comment id to reply to (from list_comments)"),
      },
    },
    async ({ path, body, quote, reply_to }) => {
      requireWrite();
      const res = await addComment(brain, auth.spaceId, allowed, mcpActor(), {
        path,
        body,
        quote,
        replyTo: reply_to,
      });
      return text({
        comment_id: res.comment.id,
        thread_id: res.thread,
        path,
        anchored: res.anchored,
      });
    },
  );

  server.registerTool(
    "resolve_comment",
    {
      title: "Resolve a comment thread",
      description:
        "Mark a comment thread as resolved once it's been handled (or reopen it with `reopen: true`). Takes a `thread_id` from list_comments.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        thread_id: z.string().describe("thread id from list_comments"),
        reopen: z.boolean().optional().describe("true to reopen a resolved thread"),
      },
    },
    async ({ thread_id, reopen }) => {
      requireWrite();
      const thread = await setThreadResolved(auth.spaceId, thread_id, !reopen, mcpActor());
      return text({ thread_id: thread.id, path: thread.path, resolved: Boolean(thread.resolvedAt) });
    },
  );

  server.registerTool(
    "list_space_comments",
    {
      title: "List comments in a company wiki",
      description:
        "Read comment threads in a company wiki you belong to — same as list_comments, but scoped to that space. With `path` returns that note's threads; without it, every unresolved thread in the wiki. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string().optional().describe("note path; omit for all open threads in the wiki"),
        include_resolved: z.boolean().optional().describe("default false"),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ space, path, include_resolved, limit }) => {
      const s = findSpace(await companySpaces(), space);
      const threads = path
        ? await listCommentThreads(brain, s.id, path, s.allowed, {
            includeResolved: include_resolved,
          })
        : await listOpenThreads(s.id, s.allowed, { limit });
      return text(threads.map(threadOut));
    },
  );

  server.registerTool(
    "add_space_comment",
    {
      title: "Comment on a company wiki note",
      description:
        "Leave a comment on a note in a company wiki you belong to — same as add_comment, but scoped to that space. Unlike the *_space write tools this does NOT require owner/admin: any member can comment on a note they can read, because commenting doesn't change the wiki's content. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string().describe("relative note path, e.g. product/spec.md"),
        body: z.string().describe("the comment text"),
        quote: z
          .string()
          .optional()
          .describe("exact text from the note to anchor to; must appear verbatim"),
        reply_to: z.string().optional().describe("comment id to reply to (from list_space_comments)"),
      },
    },
    async ({ space, path, body, quote, reply_to }) => {
      const s = findSpace(await companySpaces(), space);
      requireWrite();
      const res = await addComment(brain, s.id, s.allowed, mcpActor(s.role), {
        path,
        body,
        quote,
        replyTo: reply_to,
      });
      return text({
        space: s.slug,
        comment_id: res.comment.id,
        thread_id: res.thread,
        path,
        anchored: res.anchored,
      });
    },
  );

  server.registerTool(
    "resolve_space_comment",
    {
      title: "Resolve a company wiki comment thread",
      description:
        "Mark a comment thread in a company wiki as resolved (or reopen it with `reopen: true`) — same as resolve_comment, but scoped to that space. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        thread_id: z.string().describe("thread id from list_space_comments"),
        reopen: z.boolean().optional().describe("true to reopen a resolved thread"),
      },
    },
    async ({ space, thread_id, reopen }) => {
      const s = findSpace(await companySpaces(), space);
      requireWrite();
      const thread = await setThreadResolved(s.id, thread_id, !reopen, mcpActor(s.role));
      return text({
        space: s.slug,
        thread_id: thread.id,
        path: thread.path,
        resolved: Boolean(thread.resolvedAt),
      });
    },
  );

  // ── Media (images and video an agent can store and look at) ───────────────
  // Bytes live in a private bucket and a note body only ever carries
  // `oms-asset:<id>`. Unlike notes, media is addressed by one set of tools with
  // an optional `space`: the routing risk here is "which wiki does this
  // screenshot belong to", which a named argument answers as well as a twin
  // tool would, without doubling the surface an agent has to reason about.

  /** Resolve the `space` argument to a writable/readable target. */
  async function mediaTarget(slug?: string): Promise<{
    id: string;
    label: string;
    allowed: Visibility[];
    requireWriteHere: () => void;
  }> {
    if (!slug?.trim()) {
      return {
        id: auth.spaceId,
        label: "self",
        allowed,
        requireWriteHere: requireWrite,
      };
    }
    const s = findSpace(await companySpaces(), slug);
    return {
      id: s.id,
      label: s.slug,
      allowed: s.allowed,
      requireWriteHere: () => requireCompanyWrite(s),
    };
  }

  function assetOut(a: NoteAsset) {
    return {
      asset_id: a.id,
      ref: assetUri(a.id),
      kind: a.kind,
      mime: a.mime,
      bytes: a.sizeBytes,
      ...(a.width && a.height ? { dimensions: `${a.width}x${a.height}` } : {}),
      filename: a.originalName,
      note_path: a.path,
      created: a.createdAt,
    };
  }

  server.registerTool(
    "add_media",
    {
      title: "Store an image or video",
      description:
        "Store an image or video in the brain and get back a stable `oms-asset:<id>` reference. Use this when the person shares a screenshot, diagram, photo or clip that's worth keeping — pass the bytes as base64 in `data`, or a public link in `source_url` and the server downloads it. Give `note_path` to also embed it in that note (appends an :::image / :::video block); omit it to just store the file and place the returned `ref` yourself. Images: PNG, JPEG, WEBP, GIF, AVIF up to 10 MB. Video: MP4, WEBM, MOV up to 50 MB — for anything longer, keep it on Loom/YouTube and link it instead.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: {
        data: z
          .string()
          .optional()
          .describe("base64-encoded file contents (a `data:` URL is accepted too). Either this or source_url."),
        source_url: z
          .string()
          .optional()
          .describe("public http(s) URL for the server to download instead of sending base64"),
        mime_type: z
          .string()
          .optional()
          .describe("e.g. image/png — required with `data`, inferred from the response with source_url"),
        filename: z.string().optional(),
        note_path: z
          .string()
          .optional()
          .describe("note to embed this in, e.g. projects/bonds/_index.md — omit to only store the file"),
        alt: z.string().optional().describe("what the image shows (also its alt text)"),
        caption: z.string().optional(),
        space: z
          .string()
          .optional()
          .describe("company wiki slug from list_spaces — omit for the person's own brain"),
      },
    },
    async ({ data, source_url, mime_type, filename, note_path, alt, caption, space }) => {
      const target = await mediaTarget(space);
      target.requireWriteHere();

      let bytes: Uint8Array;
      let mime = mime_type?.trim().toLowerCase() ?? "";
      let name = filename ?? null;

      if (source_url?.trim()) {
        const remote = await fetchRemoteMedia(source_url, MAX_VIDEO_BYTES);
        bytes = remote.bytes;
        mime = mime || remote.mime;
        name = name ?? remote.filename;
      } else if (data?.trim()) {
        const inline = /^data:([^;,]+);base64,(.*)$/s.exec(data.trim());
        if (inline) {
          mime = mime || inline[1]!.toLowerCase();
          bytes = new Uint8Array(Buffer.from(inline[2]!, "base64"));
        } else {
          bytes = new Uint8Array(Buffer.from(data.trim(), "base64"));
        }
        if (!mime) throw new BadRequestError("mime_type is required when sending base64 `data`");
      } else {
        throw new BadRequestError("pass either `data` (base64) or `source_url`");
      }

      const asset = await createAsset({
        spaceId: target.id,
        path: note_path?.trim() || null,
        mime,
        bytes,
        originalName: name,
        createdBy: auth.userId,
      });

      let embedded: string | null = null;
      if (note_path?.trim()) {
        const note = await brain.appendToNote(
          target.id,
          note_path.trim(),
          mediaBlockFor(asset, { alt, caption }),
          target.allowed,
          attributionFromAuth(auth, `embedded ${asset.kind}`),
        );
        embedded = note.path;
      }

      return text(
        withUrl(
          {
            ok: true,
            ...assetOut(asset),
            ...(space ? { space: target.label } : {}),
            ...(embedded
              ? { path: embedded, embedded_in: embedded }
              : {
                  next: `Not embedded anywhere yet — put \`src: ${assetUri(asset.id)}\` inside a :::image or :::video block in a note body.`,
                }),
          },
          target.id,
        ),
      );
    },
  );

  server.registerTool(
    "get_media",
    {
      title: "Look at stored media",
      description:
        "Fetch a stored image so you can actually SEE it and reason about it — the image comes back as visual content, downscaled for vision. Use it whenever a note references `oms-asset:<id>` and the answer depends on what the picture contains (reading a screenshot, describing a diagram, comparing designs). Video can't be returned as content; for a video this returns its metadata plus a temporary signed URL. Accepts a bare id or the `oms-asset:<id>` you read out of a note.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        asset: z.string().describe("asset id, or the oms-asset:<id> reference copied from a note"),
        space: z
          .string()
          .optional()
          .describe("company wiki slug from list_spaces — omit for the person's own brain"),
      },
    },
    async ({ asset, space }) => {
      const target = await mediaTarget(space);
      const id = parseAssetRef(asset);
      const meta = await getAsset(target.id, id);

      if (meta.kind === "video") {
        const [signed] = await resolveAssets(target.id, [id]);
        return text({
          ...assetOut(meta),
          note: "Video can't be handed to a model as content. Use `url` if your client can fetch it; it expires shortly.",
          url: signed?.url ?? null,
        });
      }

      const image = await agentImage(target.id, id);
      return {
        content: [
          { type: "image" as const, data: image.base64, mimeType: image.mime },
          {
            type: "text" as const,
            text: JSON.stringify(
              { ...assetOut(meta), ...(image.downscaled ? { downscaled_for_vision: true } : {}) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_media",
    {
      title: "List stored media",
      description:
        "List the images and video stored in the brain, newest first — pass `path` for the media belonging to one note. Use it to find out what visual material exists before deciding what to look at with get_media. Note bodies reference these as `oms-asset:<id>`.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z.string().optional().describe("only media attached to this note, e.g. projects/bonds/_index.md"),
        limit: z.number().int().positive().max(200).optional(),
        space: z
          .string()
          .optional()
          .describe("company wiki slug from list_spaces — omit for the person's own brain"),
      },
    },
    async ({ path, limit, space }) => {
      const target = await mediaTarget(space);
      const assets = await listAssets(target.id, { path, limit });
      return text({
        ...(space ? { space: target.label } : {}),
        count: assets.length,
        media: assets.map(assetOut),
      });
    },
  );

  // ── Skills (portable, reusable playbooks across agents) ────────────────────

  server.registerTool(
    "save_skill",
    {
      title: "Save a skill",
      description:
        "Save a reusable skill (a playbook/instructions the person wants any agent to be able to follow). Stored at skills/<slug>/SKILL.md so it travels with their second self and can be invoked from any connected agent.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        name: z.string().describe("short skill name, e.g. 'Weekly review'"),
        description: z.string().describe("when to use this skill (one sentence)"),
        instructions: z.string().describe("the full instructions / steps in markdown"),
        tags: z.array(z.string()).optional(),
        visibility: VisibilityEnum.optional(),
      },
    },
    async ({ name, description, instructions, tags, visibility }) => {
      const body = `> ${description.trim()}\n\n${instructions.trim()}`;
      const res = await upsert(skillPath(name), {
        type: "skill",
        title: name,
        body,
        visibility,
        tags: ["skill", ...(tags ?? [])],
      });
      return text(withUrl(res));
    },
  );

  server.registerTool(
    "list_skills",
    {
      title: "List skills",
      description:
        "List the person's saved skills (name + when to use). Call this to discover what reusable playbooks are available, then run get_skill to apply one.",
      annotations: { readOnlyHint: true },
      inputSchema: {},
    },
    async () => {
      const skills = await brain.listNotes(auth.spaceId, { allowed, types: ["skill"], limit: 200 });
      return text(
        skills.map((s) => ({ name: s.title, path: s.path, when: s.excerpt, tags: s.tags })),
      );
    },
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get a skill",
      description:
        "Read a skill's full instructions so you can follow them. Accepts the skill name or its path.",
      annotations: { readOnlyHint: true },
      inputSchema: { name: z.string().describe("skill name or path") },
    },
    async ({ name }) => {
      const path = name.includes("/") ? name : skillPath(name);
      const note = await brain.readNote(auth.spaceId, path, allowed);
      return text(serializeNote(note.meta, note.body));
    },
  );

  // Expose each saved skill as a native MCP prompt (slash-command) so clients
  // like Claude/ChatGPT surface them directly. Body is read lazily on invoke.
  try {
    const skills = await brain.listNotes(auth.spaceId, { allowed, types: ["skill"], limit: 200 });
    const seen = new Set<string>();
    for (const s of skills) {
      let name = slugify(s.title || s.path);
      while (seen.has(name)) name = `${name}-1`;
      seen.add(name);
      server.registerPrompt(
        name,
        { title: s.title, description: (s.excerpt ?? "skill").slice(0, 140) },
        async () => {
          const note = await brain.readNote(auth.spaceId, s.path, allowed);
          return {
            messages: [{ role: "user" as const, content: { type: "text" as const, text: note.body } }],
          };
        },
      );
    }
  } catch {
    /* skills are optional; never block the connection */
  }

  return server;
}
