import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addToProject,
  allowedVisibilities,
  buildCore,
  buildFriendDirectory,
  canWrite,
  distillEnabled,
  getDisplayName,
  getUserConfig,
  ingest,
  listCommitments,
  listSpacesForUser,
  profilePerson,
  profileStalePeople,
  serializeNote,
  setCommitmentStatus,
  setUserConfig,
  slugify,
  stampFlowyaTaskId,
  todayISO,
  upsertPerson,
  upsertProject,
  type AuthContext,
  type CommitmentOwner,
  type CommitmentStatus,
  type FriendEntry,
  type NoteType,
  type ProjectKind,
  type Space,
  type SpaceRole,
  type UserConfig,
  type Visibility,
} from "../core/index.js";
import { ForbiddenError, NotFoundError } from "../core/errors.js";
import { applyLintCull, applyLintMerge, applyLintRehome, getLintReport } from "../lint.js";

const VisibilityEnum = z.enum(["public", "private", "secret"]);

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

/** Build an MCP server whose tools operate on `auth`'s brain, scoped to its
 *  visibility level. Used by both the stdio and Streamable HTTP transports.
 *  Async because it lists the user's skills to expose them as MCP prompts. */
export async function buildMcpServer(auth: AuthContext): Promise<McpServer> {
  const core = buildCore();
  const { brain } = core;
  const allowed = allowedVisibilities(auth.scope);
  const server = new McpServer({ name: "ohmyself", version: "0.2.0" });

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

  // ── Read / recall ────────────────────────────────────────────────────────

  server.registerTool(
    "search_brain",
    {
      title: "Search",
      description:
        "Full-text search across the person's notes. Returns matching notes (path, title, type, visibility, tags, excerpt). Respects privacy.",
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
      description: "Read the full markdown (frontmatter + body) of a note by its path.",
      annotations: { readOnlyHint: true },
      inputSchema: { path: z.string().describe("relative note path, e.g. projects/x/_index.md") },
    },
    async ({ path }) => {
      const note = await brain.readNote(auth.spaceId, path, allowed);
      return text(serializeNote(note.meta, note.body));
    },
  );

  server.registerTool(
    "recall",
    {
      title: "Recall about a topic",
      description:
        "Recall everything relevant about a topic or question. Aggregates the most relevant notes into one context blob to ground an answer. Use this before answering questions about the person.",
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
        scope: auth.scope,
        canWrite: !auth.readonly && canWrite(auth.scope),
        categories: cfg.noteTypes,
        conventions: {
          identity: "identity/about-me.md (use update_identity)",
          goals: "goals/<year>/yearly.md or goals/<year>/q<n>.md (use set_goal)",
          projects: "projects/<slug>/_index.md is the overview; nest docs in prds/, specs/, transcripts/, notes/, subprojects/<slug>/_index.md (use upsert_project, add_to_project)",
          people: "people/<slug>.md (use add_person)",
          journal: "journal/<year>/<date>.md (use log_journal)",
          todos: "todos/<list>.md as checkbox lines (use add_todo)",
          memory: "memory/log.md — quick durable facts learned in conversation (use remember)",
        },
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
        "List the people who've shared their brain (read-only) with you. Returns each friend's slug (use it as the `friend` argument for recall_friend, search_friend_brain, list_friend_notes, read_friend_note, who_is_friend) and the visibility level they granted you.",
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
    const cap = allowedVisibilities(auth.scope);
    // Plain members never see founders-only ("secret") company notes.
    return role === "owner" || role === "admin" ? cap : cap.filter((v) => v !== "secret");
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
        "Read the full markdown of one note in a company wiki you belong to by path — same as read_note, but scoped to that space. Read-only. Call list_spaces first for valid `space` values.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string().describe("relative note path, e.g. product/spec.md"),
      },
    },
    async ({ space, path }) => {
      const s = findSpace(await companySpaces(), space);
      const note = await brain.readNote(s.id, path, s.allowed);
      return text(serializeNote(note.meta, note.body));
    },
  );

  server.registerTool(
    "create_space_note",
    {
      title: "Create a company wiki note",
      description:
        "Create a note inside a company wiki selected by its stable space slug. Requires owner/admin role and a writable connection. Never writes to the personal brain.",
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
      },
    },
    async ({ space, ...args }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      if (args.visibility && !s.allowed.includes(args.visibility)) {
        throw new ForbiddenError("cannot create a company note above your scope");
      }
      const note = await brain.createNote(s.id, args, await getUserConfig(s.id), s.allowed);
      return text({ space: s.slug, created: note.path, meta: note.meta });
    },
  );

  server.registerTool(
    "update_space_note",
    {
      title: "Update a company wiki note",
      description:
        "Update a note's body and/or frontmatter inside a company wiki. Requires owner/admin role and a writable connection.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string(),
        body: z.string().optional(),
        title: z.string().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
      },
    },
    async ({ space, path, ...patch }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      if (patch.visibility && !s.allowed.includes(patch.visibility)) {
        throw new ForbiddenError("cannot update a company note above your scope");
      }
      const note = await brain.updateNote(s.id, path, patch, s.allowed);
      return text({ space: s.slug, updated: note.path, meta: note.meta });
    },
  );

  server.registerTool(
    "append_space_note",
    {
      title: "Append to a company wiki note",
      description:
        "Append text to a note inside a company wiki. Requires owner/admin role and a writable connection.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        space: z.string().describe("space slug from list_spaces"),
        path: z.string(),
        text: z.string(),
      },
    },
    async ({ space, path, text: content }) => {
      const s = findSpace(await companySpaces(), space);
      requireCompanyWrite(s);
      const note = await brain.appendToNote(s.id, path, content, s.allowed);
      return text({ space: s.slug, appended: note.path });
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
      return text({
        ok: true,
        space: s.slug,
        path: note.path,
        created,
        visibility: note.meta.visibility,
      });
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
      return text({ ...res, remembered: t.trim() });
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
      return text(res);
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
      return text(res);
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
      return text(res);
    },
  );

  server.registerTool(
    "add_to_project",
    {
      title: "Add a document to a project",
      description:
        "Add or update a document inside a project: a PRD, spec, meeting transcript, note, or a nested sub-project. Path is derived from the project + kind + title.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        project: z.string().describe("the parent project name"),
        kind: z.enum(["prd", "spec", "transcript", "note", "subproject"]),
        title: z.string(),
        body: z.string().optional(),
        append: z.boolean().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ project, kind, title, body, append, visibility, tags }) => {
      requireWrite();
      const res = await addToProject(brain, auth.spaceId, await config(), allowed, {
        project,
        kind: kind as ProjectKind,
        title,
        body,
        append,
        visibility,
        tags,
      });
      return text(res);
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
      return text(res);
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
      return text(res);
    },
  );

  server.registerTool(
    "add_todo",
    {
      title: "Add a to-do",
      description:
        "Add an unchecked to-do item to a list at todos/<list>.md (default list: 'life'). Optionally attach it to a project list.",
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

  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description:
        "Create a new markdown note. Path is derived from type+title unless provided. Prefer the high-level tools (update_identity, upsert_project, …) when they fit.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        type: z.string().describe("note type (identity, goal, project, person, journal, ...)"),
        title: z.string(),
        body: z.string().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
        path: z.string().optional(),
      },
    },
    async (args) => {
      requireWrite();
      if (args.visibility && !allowed.includes(args.visibility)) {
        throw new ForbiddenError("cannot create a note above your scope");
      }
      // Pass `allowed` so a note can't exceed scope via its type's default visibility.
      const note = await brain.createNote(auth.spaceId, args, await config(), allowed);
      return text({ created: note.path, meta: note.meta });
    },
  );

  server.registerTool(
    "update_note",
    {
      title: "Update a note",
      description: "Update a note's body and/or frontmatter by path. Requires a writable scope.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: {
        path: z.string(),
        body: z.string().optional(),
        title: z.string().optional(),
        visibility: VisibilityEnum.optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.string()).optional(),
      },
    },
    async ({ path, ...patch }) => {
      requireWrite();
      const note = await brain.updateNote(auth.spaceId, path, patch, allowed);
      return text({ updated: note.path, meta: note.meta });
    },
  );

  server.registerTool(
    "append_to_note",
    {
      title: "Append to a note",
      description: "Append text to the end of a note's body by path.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: { path: z.string(), text: z.string() },
    },
    async ({ path, text: t }) => {
      requireWrite();
      const note = await brain.appendToNote(auth.spaceId, path, t, allowed);
      return text({ appended: note.path });
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
      return text(res);
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
