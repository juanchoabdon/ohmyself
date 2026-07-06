import { Hono } from "hono";
import { cors } from "hono/cors";
import { resolveAuth } from "../auth.js";
import {
  allowedVisibilities,
  buildCore,
  canWrite,
  createToken,
  getProfileSummary,
  getUserConfig,
  isFriendVisibility,
  isScope,
  listSharedByMe,
  listSharedWithMe,
  listTokens,
  revokeShare,
  revokeToken,
  searchUsers,
  serializeNote,
  setUserConfig,
  setUsername,
  shareWith,
  type AuthContext,
  type Scope,
  type Visibility,
} from "../core/index.js";
import { BadRequestError, BrainError, ForbiddenError } from "../core/errors.js";
import { embedTexts, embeddingsEnabled, semanticEdges } from "../core/embeddings.js";
import { connectors, getConnector } from "../connectors/index.js";
import { seedTemplateBrain } from "../templates.js";
import { registerOAuth } from "./oauth.js";

type Env = { Variables: { auth: AuthContext } };

function csv(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const arr = v.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

function requireWrite(auth: AuthContext) {
  if (auth.readonly || !canWrite(auth.scope)) {
    throw new ForbiddenError("read-only (public scope)");
  }
}

/** Token management is only allowed from a signed-in web session, never from
 *  an API token itself (so a leaked token can't mint more tokens). */
function requireJwt(auth: AuthContext) {
  if (auth.via !== "jwt") {
    throw new ForbiddenError("manage tokens from a signed-in session");
  }
}

export function createApp(): Hono<Env> {
  const app = new Hono<Env>();
  const { brain } = buildCore();

  app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Brain-Scope"] }));

  app.get("/health", (c) => c.json({ ok: true, service: "ohmyself", version: "0.1.0" }));

  // OAuth 2.1 authorization server + discovery (public; no /v1 auth guard).
  registerOAuth(app);

  // Auth for everything under /v1
  app.use("/v1/*", async (c, next) => {
    const auth = await resolveAuth({
      authorization: c.req.header("authorization"),
      "x-brain-scope": c.req.header("x-brain-scope"),
    });
    c.set("auth", auth);
    await next();
  });

  app.get("/v1/me", async (c) => {
    const auth = c.get("auth");
    const profile = await getProfileSummary(auth.userId);
    return c.json({
      userId: auth.userId,
      scope: auth.scope,
      readonly: auth.readonly,
      via: auth.via,
      username: profile?.username ?? null,
      displayName: profile?.displayName ?? null,
    });
  });

  app.put("/v1/me/username", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const { username } = await c.req.json<{ username?: string }>();
    if (!username?.trim()) throw new BadRequestError("username is required");
    const saved = await setUsername(auth.userId, username);
    return c.json({ username: saved });
  });

  // Find people to share your brain with — matches @handle or display name,
  // never raw email. Requires a signed-in session (not a leaked personal token).
  app.get("/v1/users/search", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const q = c.req.query("q") ?? "";
    const results = await searchUsers(q, auth.userId, 10);
    return c.json({ users: results });
  });

  // ── Personal API tokens (for MCP clients / external tools) ────────────────
  app.get("/v1/tokens", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    return c.json({ tokens: await listTokens(auth.userId) });
  });

  app.post("/v1/tokens", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; scope?: string };
    const scope: Scope = isScope(body.scope) ? body.scope : "secret";
    const { token, row } = await createToken(auth.userId, (body.name ?? "").trim() || "token", scope);
    // `token` (plaintext) is returned ONCE and never stored in clear.
    return c.json({ token, ...row }, 201);
  });

  app.delete("/v1/tokens/:id", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    await revokeToken(auth.userId, c.req.param("id"));
    return c.json({ revoked: c.req.param("id") });
  });

  // ── Friends (read-only cross-brain sharing) ────────────────────────────────
  // A one-way grant the OWNER controls: share your brain, read-only, up to a
  // visibility ceiling (never `secret`), with another ohmyself! account by
  // email. Management is JWT-only, same as tokens — a leaked personal token
  // shouldn't be able to grant strangers access to your brain.
  app.get("/v1/friends/shared-by-me", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    return c.json({ shares: await listSharedByMe(auth.userId) });
  });

  app.post("/v1/friends/shared-by-me", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const body = await c.req.json<{ identifier?: string; maxVisibility?: string }>();
    const maxVisibility = isFriendVisibility(body.maxVisibility) ? body.maxVisibility : "public";
    if (!body.identifier?.trim()) throw new BadRequestError("who to share with is required");
    const share = await shareWith(auth.userId, body.identifier, maxVisibility);
    return c.json({ share }, 201);
  });

  app.delete("/v1/friends/shared-by-me/:id", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    await revokeShare(auth.userId, c.req.param("id"));
    return c.json({ revoked: c.req.param("id") });
  });

  app.get("/v1/friends/shared-with-me", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    return c.json({ shares: await listSharedWithMe(auth.userId) });
  });

  // Onboard a new user. By default this sets up STRUCTURE ONLY — it returns the
  // user's category taxonomy and creates no files, so a fresh account starts
  // empty and ready to fill. Pass `?demo=1` to also seed the example template
  // brain (used for demos / the owner's own account).
  app.post("/v1/onboard", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const config = await getUserConfig(auth.userId);
    const structure = [...new Set(config.noteTypes.map((t) => t.folder))];

    const demo = c.req.query("demo") === "1" || c.req.query("demo") === "true";
    if (!demo) {
      return c.json({ seeded: [], structure });
    }

    const existing = await brain.listNotes(auth.userId, {
      allowed: allowedVisibilities(auth.scope),
      limit: 1,
    });
    if (existing.length > 0) {
      return c.json({ seeded: [], structure, alreadyHadNotes: true });
    }
    const seeded = await seedTemplateBrain(brain, auth.userId);
    return c.json({ seeded, structure, alreadyHadNotes: false });
  });

  // The user's category structure (taxonomy), with stable folder + label.
  app.get("/v1/structure", async (c) => {
    const auth = c.get("auth");
    const config = await getUserConfig(auth.userId);
    const seen = new Set<string>();
    const categories: { folder: string; label: string }[] = [];
    for (const t of config.noteTypes) {
      if (seen.has(t.folder)) continue;
      seen.add(t.folder);
      categories.push({ folder: t.folder, label: t.folder });
    }
    return c.json({ categories });
  });

  app.get("/v1/search", async (c) => {
    const auth = c.get("auth");
    const allowed = allowedVisibilities(auth.scope);
    const q = c.req.query("q") ?? "";
    const limit = Number(c.req.query("limit") ?? "50");
    const res = await brain.search(auth.userId, q, {
      allowed,
      types: csv(c.req.query("type")),
      tags: csv(c.req.query("tags")),
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return c.json({ results: res });
  });

  app.get("/v1/notes", async (c) => {
    const auth = c.get("auth");
    const allowed = allowedVisibilities(auth.scope);
    const limit = Number(c.req.query("limit") ?? "200");
    const res = await brain.listNotes(auth.userId, {
      allowed,
      types: csv(c.req.query("type")),
      tags: csv(c.req.query("tags")),
      limit: Number.isFinite(limit) ? limit : 200,
    });
    return c.json({ notes: res });
  });

  app.post("/v1/notes", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    const body = await c.req.json<{
      type: string;
      title: string;
      body?: string;
      visibility?: Visibility;
      tags?: string[];
      links?: string[];
      path?: string;
    }>();
    if (body.visibility && !allowed.includes(body.visibility)) {
      throw new ForbiddenError("cannot create a note above your scope");
    }
    const config = await getUserConfig(auth.userId);
    // Pass `allowed` so a note can't exceed scope via its type's default visibility.
    const note = await brain.createNote(auth.userId, body, config, allowed);
    return c.json({ path: note.path, meta: note.meta }, 201);
  });

  app.get("/v1/notes/:path{.+}", async (c) => {
    const auth = c.get("auth");
    const allowed = allowedVisibilities(auth.scope);
    const note = await brain.readNote(auth.userId, c.req.param("path"), allowed);
    return c.json({ path: note.path, meta: note.meta, body: note.body, raw: serializeNote(note.meta, note.body) });
  });

  app.patch("/v1/notes/:path{.+}", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    const patch = await c.req.json();
    const note = await brain.updateNote(auth.userId, c.req.param("path"), patch, allowed);
    return c.json({ path: note.path, meta: note.meta });
  });

  app.delete("/v1/notes/:path{.+}", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    await brain.deleteNote(auth.userId, c.req.param("path"), allowed);
    return c.json({ deleted: c.req.param("path") });
  });

  app.post("/v1/move", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    const { from, to } = await c.req.json<{ from: string; to: string }>();
    const note = await brain.moveNote(auth.userId, from, to, allowed);
    return c.json({ path: note.path, meta: note.meta });
  });

  app.post("/v1/append", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    const { path, text } = await c.req.json<{ path: string; text: string }>();
    const note = await brain.appendToNote(auth.userId, path, text, allowed);
    return c.json({ appended: note.path });
  });

  app.post("/v1/link", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    const { a, b } = await c.req.json<{ a: string; b: string }>();
    await brain.linkNotes(auth.userId, a, b, allowed);
    return c.json({ linked: [a, b] });
  });

  // Semantic "idea links" for the Brain Map: fuzzy edges between notes that are
  // topically close even when not explicitly linked. Embeds only title+excerpt
  // (never full bodies), respects scope, and caches vectors by content hash.
  app.get("/v1/graph/semantic", async (c) => {
    const auth = c.get("auth");
    if (!embeddingsEnabled()) return c.json({ enabled: false, edges: [] });
    const allowed = allowedVisibilities(auth.scope);
    const notes = await brain.listNotes(auth.userId, { allowed, limit: 400 });
    const items = notes
      .map((n) => ({ path: n.path, text: `${n.title}. ${n.excerpt ?? ""}`.trim() }))
      .filter((x) => x.text.length > 2);
    if (items.length < 2) return c.json({ enabled: true, edges: [], count: items.length });

    const vecs = await embedTexts(items.map((x) => x.text));
    const withVec = items
      .map((x, i) => ({ path: x.path, vec: vecs[i] }))
      .filter((x): x is { path: string; vec: number[] } => Array.isArray(x.vec) && x.vec.length > 0);

    const edges = semanticEdges(withVec, { topK: 3, min: 0.42 });
    return c.json({ enabled: true, edges, count: withVec.length });
  });

  app.post("/v1/context", async (c) => {
    const auth = c.get("auth");
    const allowed = allowedVisibilities(auth.scope);
    const { topic, limit } = await c.req.json<{ topic: string; limit?: number }>();
    const ctx = await brain.getContext(auth.userId, topic, allowed, limit ?? 6);
    return c.json(ctx);
  });

  app.get("/v1/connectors", (c) =>
    c.json({
      connectors: Object.values(connectors).map((k) => ({
        id: k.id,
        label: k.label,
        description: k.description,
      })),
    }),
  );

  app.post("/v1/connectors/:id/pull", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const connector = getConnector(c.req.param("id"));
    if (!connector) throw new BadRequestError(`unknown connector: ${c.req.param("id")}`);
    const options = await c.req.json().catch(() => ({}));
    const config = await getUserConfig(auth.userId);
    const result = await connector.pull(
      { userId: auth.userId, brain, allowed: allowedVisibilities(auth.scope), config },
      options,
    );
    return c.json(result);
  });

  app.get("/v1/config", async (c) => {
    const auth = c.get("auth");
    return c.json(await getUserConfig(auth.userId));
  });

  app.put("/v1/config", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const raw = await c.req.json();
    return c.json(await setUserConfig(auth.userId, raw));
  });

  app.onError((err, c) => {
    if (err instanceof BrainError) return c.json({ error: err.message }, err.status as 400);
    console.error("[api] error:", err);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
