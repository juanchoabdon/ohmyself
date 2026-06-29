import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  allowedVisibilities,
  buildCore,
  canWrite,
  getDisplayName,
  getUserConfig,
  serializeNote,
  slugify,
  todayISO,
  type AuthContext,
  type UserConfig,
} from "../core/index.js";
import { ForbiddenError } from "../core/errors.js";

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

const PROJECT_KINDS = {
  prd: { folder: "prds", type: "prd", index: false },
  spec: { folder: "specs", type: "spec", index: false },
  transcript: { folder: "transcripts", type: "transcript", index: false },
  note: { folder: "notes", type: "note", index: false },
  subproject: { folder: "subprojects", type: "project", index: true },
} as const;

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
    return (_config ??= await getUserConfig(auth.userId));
  }
  async function upsert(
    path: string,
    input: Parameters<typeof brain.upsertNote>[2],
  ) {
    requireWrite();
    const { note, created } = await brain.upsertNote(auth.userId, path, input, await config(), allowed);
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
      const res = await brain.search(auth.userId, query, { allowed, types, tags, limit });
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
      const res = await brain.listNotes(auth.userId, {
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
      const note = await brain.readNote(auth.userId, path, allowed);
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
      const ctx = await brain.getContext(auth.userId, topic, allowed, limit ?? 6);
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
      const name = await getDisplayName(auth.userId);
      // Framing instruction so the agent answers in-character as the second self.
      const persona = name
        ? `You are speaking as the second self of ${name}. Begin your reply with "I'm the second self of ${name}." then summarize who they are using only the profile below.`
        : `You are speaking as this person's second self. Begin your reply with "I'm your second self." then summarize who they are using only the profile below.`;

      const idNotes = await brain.listNotes(auth.userId, { allowed, types: ["identity"], limit: 50 });
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
          const note = await brain.readNote(auth.userId, n.path, allowed);
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
        "Return the taxonomy (categories + folders) and the conventions for where things live. Call this first when you're unsure where to write something.",
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
      const slug = slugify(name);
      const header = status ? `> Status: **${status}**\n\n` : "";
      const res = await upsert(`projects/${slug}/_index.md`, {
        type: "project",
        title: name,
        body: summary !== undefined ? `${header}${summary}` : undefined,
        append,
        tags,
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
      const k = PROJECT_KINDS[kind];
      const base = `projects/${slugify(project)}/${k.folder}/${slugify(title)}`;
      const path = k.index ? `${base}/_index.md` : `${base}.md`;
      const res = await upsert(path, { type: k.type, title, body, append, visibility, tags });
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
      const rel = relationship ? `> ${relationship}\n\n` : "";
      const body = notes !== undefined || relationship ? `${rel}${notes ?? ""}` : undefined;
      const res = await upsert(`people/${slugify(name)}.md`, {
        type: "person",
        title: name,
        body,
        append,
        visibility,
        tags,
      });
      return text(res);
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
      const note = await brain.createNote(auth.userId, args, await config(), allowed);
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
      const note = await brain.updateNote(auth.userId, path, patch, allowed);
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
      const note = await brain.appendToNote(auth.userId, path, t, allowed);
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
      await brain.linkNotes(auth.userId, a, b, allowed);
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
      const skills = await brain.listNotes(auth.userId, { allowed, types: ["skill"], limit: 200 });
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
      const note = await brain.readNote(auth.userId, path, allowed);
      return text(serializeNote(note.meta, note.body));
    },
  );

  // Expose each saved skill as a native MCP prompt (slash-command) so clients
  // like Claude/ChatGPT surface them directly. Body is read lazily on invoke.
  try {
    const skills = await brain.listNotes(auth.userId, { allowed, types: ["skill"], limit: 200 });
    const seen = new Set<string>();
    for (const s of skills) {
      let name = slugify(s.title || s.path);
      while (seen.has(name)) name = `${name}-1`;
      seen.add(name);
      server.registerPrompt(
        name,
        { title: s.title, description: (s.excerpt ?? "skill").slice(0, 140) },
        async () => {
          const note = await brain.readNote(auth.userId, s.path, allowed);
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
