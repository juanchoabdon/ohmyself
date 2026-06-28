import { Hono } from "hono";
import { cors } from "hono/cors";
import { resolveAuth } from "../auth.js";
import {
  allowedVisibilities,
  buildCore,
  canWrite,
  getUserConfig,
  serializeNote,
  setUserConfig,
  type AuthContext,
  type Visibility,
} from "../core/index.js";
import { BadRequestError, BrainError, ForbiddenError } from "../core/errors.js";
import { connectors, getConnector } from "../connectors/index.js";
import { seedTemplateBrain } from "../templates.js";

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

export function createApp(): Hono<Env> {
  const app = new Hono<Env>();
  const { brain } = buildCore();

  app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Brain-Scope"] }));

  app.get("/health", (c) => c.json({ ok: true, service: "ohmyself", version: "0.1.0" }));

  // Auth for everything under /v1
  app.use("/v1/*", async (c, next) => {
    const auth = await resolveAuth({
      authorization: c.req.header("authorization"),
      "x-brain-scope": c.req.header("x-brain-scope"),
    });
    c.set("auth", auth);
    await next();
  });

  app.get("/v1/me", (c) => {
    const auth = c.get("auth");
    return c.json({ userId: auth.userId, scope: auth.scope, readonly: auth.readonly });
  });

  // Seed a new user's brain from the default template (idempotent: no-op if the
  // brain already has notes). Called by the web app right after signup.
  app.post("/v1/onboard", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const existing = await brain.listNotes(auth.userId, {
      allowed: allowedVisibilities(auth.scope),
      limit: 1,
    });
    if (existing.length > 0) {
      return c.json({ seeded: [], alreadyHadNotes: true });
    }
    const seeded = await seedTemplateBrain(brain, auth.userId);
    return c.json({ seeded, alreadyHadNotes: false });
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
    const note = await brain.createNote(auth.userId, body, config);
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
