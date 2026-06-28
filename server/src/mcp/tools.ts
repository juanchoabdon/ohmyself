import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  allowedVisibilities,
  buildCore,
  canWrite,
  getUserConfig,
  serializeNote,
  type AuthContext,
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

function requireWrite(auth: AuthContext) {
  if (auth.readonly || !canWrite(auth.scope)) {
    throw new ForbiddenError("this connection is read-only (public scope)");
  }
}

/** Build an MCP server whose tools operate on `auth`'s brain, scoped to its
 *  visibility level. Used by both the stdio and Streamable HTTP transports. */
export function buildMcpServer(auth: AuthContext): McpServer {
  const core = buildCore();
  const { brain } = core;
  const allowed = allowedVisibilities(auth.scope);
  const server = new McpServer({ name: "ohmyself", version: "0.1.0" });

  server.registerTool(
    "search_brain",
    {
      title: "Search the brain",
      description:
        "Full-text search across the user's notes. Returns matching notes (path, title, type, visibility, tags, excerpt). Respects privacy.",
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
      inputSchema: { path: z.string().describe("relative note path, e.g. projects/x/_index.md") },
    },
    async ({ path }) => {
      const note = await brain.readNote(auth.userId, path, allowed);
      return text(serializeNote(note.meta, note.body));
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description:
        "Create a new markdown note. Path is derived from type+title unless provided. Requires a writable (non-public) scope.",
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
      requireWrite(auth);
      if (args.visibility && !allowed.includes(args.visibility)) {
        throw new ForbiddenError("cannot create a note above your scope");
      }
      const config = await getUserConfig(auth.userId);
      const note = await brain.createNote(auth.userId, args, config);
      return text({ created: note.path, meta: note.meta });
    },
  );

  server.registerTool(
    "update_note",
    {
      title: "Update a note",
      description: "Update a note's body and/or frontmatter. Requires a writable scope.",
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
      requireWrite(auth);
      const note = await brain.updateNote(auth.userId, path, patch, allowed);
      return text({ updated: note.path, meta: note.meta });
    },
  );

  server.registerTool(
    "append_to_note",
    {
      title: "Append to a note",
      description: "Append text to the end of a note's body (great for journals and todo lists).",
      inputSchema: { path: z.string(), text: z.string() },
    },
    async ({ path, text: t }) => {
      requireWrite(auth);
      const note = await brain.appendToNote(auth.userId, path, t, allowed);
      return text({ appended: note.path });
    },
  );

  server.registerTool(
    "link_notes",
    {
      title: "Link two notes",
      description: "Create a bidirectional link between two notes by path.",
      inputSchema: { a: z.string(), b: z.string() },
    },
    async ({ a, b }) => {
      requireWrite(auth);
      await brain.linkNotes(auth.userId, a, b, allowed);
      return text({ linked: [a, b] });
    },
  );

  server.registerTool(
    "get_context",
    {
      title: "Get context for a topic",
      description:
        "Aggregate the most relevant notes for a topic into one context blob for answering a question. Respects privacy.",
      inputSchema: {
        topic: z.string(),
        limit: z.number().int().positive().max(20).optional(),
      },
    },
    async ({ topic, limit }) => {
      const ctx = await brain.getContext(auth.userId, topic, allowed, limit ?? 6);
      return text(ctx);
    },
  );

  return server;
}
