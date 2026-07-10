import { Hono } from "hono";
import { cors } from "hono/cors";
import { resolveAuth } from "../auth.js";
import {
  allowedVisibilities,
  buildCore,
  canWrite,
  addMember,
  createCompanySpace,
  createToken,
  getProfileSummary,
  getSpace,
  getUserConfig,
  isFriendVisibility,
  isScope,
  listMembers,
  listSharedByMe,
  listSharedWithMe,
  listSpacesForUser,
  listTokens,
  logoBucket,
  removeMember,
  resolveRole,
  revokeShare,
  revokeToken,
  searchUsers,
  serializeNote,
  serviceClient,
  setUserConfig,
  setUsername,
  shareWith,
  updateMemberRole,
  updateSpace,
  type AuthContext,
  type Scope,
  type Visibility,
} from "../core/index.js";
import { BadRequestError, BrainError, ForbiddenError } from "../core/errors.js";
import { embedTexts, embeddingsEnabled, semanticEdges } from "../core/embeddings.js";
import { connectors, getConnector } from "../connectors/index.js";
import {
  GOOGLE_DRIVE_MEETINGS_PROVIDER,
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  googleAuthConfigured,
  verifyState,
} from "../connectors/google-auth.js";
import {
  deleteConnection,
  listConnections,
  upsertConnection,
  type ConnectionSettings,
} from "../core/index.js";
import { seedTemplateBrain } from "../templates.js";
import { syncDriveConnection } from "../sync.js";
import { startBackfill } from "../backfill.js";
import { runScheduledTick } from "../scheduler.js";
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

/** Decode a `data:<mime>;base64,<payload>` URL into its content type and bytes. */
function parseDataUrl(dataUrl?: string): { contentType: string; bytes: Buffer } | null {
  if (!dataUrl) return null;
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
  const contentType = m?.[1];
  const payload = m?.[2];
  if (!contentType || !payload) return null;
  try {
    return { contentType: contentType.toLowerCase(), bytes: Buffer.from(payload, "base64") };
  } catch {
    return null;
  }
}

export function createApp(): Hono<Env> {
  const app = new Hono<Env>();
  const { brain } = buildCore();

  app.use("*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Brain-Scope", "X-Brain-Space"] }));

  app.get("/health", (c) => c.json({ ok: true, service: "ohmyself", version: "0.1.0" }));

  // Scheduled sync (Vercel Cron). Public route guarded by CRON_SECRET: Vercel
  // sends it as `Authorization: Bearer <CRON_SECRET>` on a GET request.
  // Iterates every active auto-sync connection and distills new meeting notes.
  app.on(["GET", "POST"], "/cron/sync", async (c) => {
    const secret = process.env.CRON_SECRET;
    const provided = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!secret || provided !== secret) throw new ForbiddenError("invalid cron secret");

    // Manual trigger for the same work the in-process scheduler runs: pull new
    // meetings for auto-sync connections and resume any stalled backfill.
    const { synced, resumed } = await runScheduledTick();
    return c.json({ synced, resumed });
  });

  // OAuth 2.1 authorization server + discovery (public; no /v1 auth guard).
  registerOAuth(app);

  // Auth for everything under /v1
  app.use("/v1/*", async (c, next) => {
    const auth = await resolveAuth({
      authorization: c.req.header("authorization"),
      "x-brain-scope": c.req.header("x-brain-scope"),
      "x-brain-space": c.req.header("x-brain-space"),
    });
    c.set("auth", auth);
    await next();
  });

  app.get("/v1/me", async (c) => {
    const auth = c.get("auth");
    const profile = await getProfileSummary(auth.userId);
    return c.json({
      userId: auth.userId,
      spaceId: auth.spaceId,
      role: auth.role,
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

  // ── Spaces (personal "self" + company brains) ─────────────────────────────
  // Every space the caller belongs to (self first). Powers the header switcher.
  app.get("/v1/spaces", async (c) => {
    const auth = c.get("auth");
    return c.json({ spaces: await listSpacesForUser(auth.userId), activeSpaceId: auth.spaceId });
  });

  // Create a company space and become its owner. The default company taxonomy
  // is seeded automatically, so it opens pre-populated with the right sections.
  app.post("/v1/spaces", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    requireWrite(auth);
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      slug?: string;
      themeColor?: string | null;
      logoUrl?: string | null;
    };
    if (!body.name?.trim()) throw new BadRequestError("space name is required");
    const space = await createCompanySpace({
      ownerUserId: auth.userId,
      name: body.name,
      slug: body.slug,
      themeColor: body.themeColor ?? null,
      logoUrl: body.logoUrl ?? null,
    });
    return c.json({ space }, 201);
  });

  // Rename / rebrand a space (name, accent color, logo). Owner only.
  app.patch("/v1/spaces/:id", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    requireWrite(auth);
    const id = c.req.param("id");
    const space = await getSpace(id);
    if (!space) throw new BadRequestError("space not found");
    const role = await resolveRole(auth.userId, id);
    if (role !== "owner") throw new ForbiddenError("only the owner can edit a space");
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      themeColor?: string | null;
      logoUrl?: string | null;
    };
    const updated = await updateSpace(id, {
      name: body.name,
      themeColor: body.themeColor,
      logoUrl: body.logoUrl,
    });
    return c.json({ space: updated });
  });

  // Upload a logo for a space. Owner only. Accepts a base64 data URL, stores it
  // in the public logo bucket, and returns the persisted public URL.
  app.post("/v1/spaces/:id/logo", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    requireWrite(auth);
    const id = c.req.param("id");
    const space = await getSpace(id);
    if (!space) throw new BadRequestError("space not found");
    if ((await resolveRole(auth.userId, id)) !== "owner") {
      throw new ForbiddenError("only the owner can change the logo");
    }
    const body = (await c.req.json().catch(() => ({}))) as { dataUrl?: string };
    const parsed = parseDataUrl(body.dataUrl);
    if (!parsed) throw new BadRequestError("expected a base64 image data URL");
    const allowed: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/gif": "gif",
    };
    const ext = allowed[parsed.contentType];
    if (!ext) throw new BadRequestError("logo must be PNG, JPEG, WEBP, GIF, or SVG");
    if (parsed.bytes.byteLength > 2 * 1024 * 1024) {
      throw new BadRequestError("logo must be under 2 MB");
    }
    const sb = serviceClient();
    const key = `${id}/logo-${Date.now()}.${ext}`;
    const { error } = await sb.storage
      .from(logoBucket())
      .upload(key, parsed.bytes, { contentType: parsed.contentType, upsert: true });
    if (error) throw new BrainError(`logo upload failed: ${error.message}`, 502);
    const { data } = sb.storage.from(logoBucket()).getPublicUrl(key);
    const updated = await updateSpace(id, { logoUrl: data.publicUrl });
    return c.json({ space: updated, logoUrl: data.publicUrl });
  });

  // Roster of a space. Any member can read it; only the owner manages it.
  app.get("/v1/spaces/:id/members", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const role = await resolveRole(auth.userId, id);
    if (!role) throw new ForbiddenError("not a member of this space");
    return c.json({ members: await listMembers(id) });
  });

  app.post("/v1/spaces/:id/members", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const id = c.req.param("id");
    if ((await resolveRole(auth.userId, id)) !== "owner") {
      throw new ForbiddenError("only the owner can add members");
    }
    const body = (await c.req.json().catch(() => ({}))) as { identifier?: string; role?: string };
    if (!body.identifier?.trim()) throw new BadRequestError("who to add is required");
    const role = body.role === "admin" ? "admin" : "member";
    const member = await addMember(id, body.identifier, role);
    return c.json({ member }, 201);
  });

  app.patch("/v1/spaces/:id/members/:userId", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const id = c.req.param("id");
    if ((await resolveRole(auth.userId, id)) !== "owner") {
      throw new ForbiddenError("only the owner can change roles");
    }
    const body = (await c.req.json().catch(() => ({}))) as { role?: string };
    const role = body.role === "admin" ? "admin" : "member";
    await updateMemberRole(id, c.req.param("userId"), role);
    return c.json({ ok: true });
  });

  app.delete("/v1/spaces/:id/members/:userId", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const id = c.req.param("id");
    const target = c.req.param("userId");
    // Owner can remove anyone; a member can remove themselves (leave).
    const role = await resolveRole(auth.userId, id);
    if (role !== "owner" && auth.userId !== target) {
      throw new ForbiddenError("only the owner can remove other members");
    }
    await removeMember(id, target);
    return c.json({ removed: target });
  });

  // Onboard a new user. By default this sets up STRUCTURE ONLY — it returns the
  // user's category taxonomy and creates no files, so a fresh account starts
  // empty and ready to fill. Pass `?demo=1` to also seed the example template
  // brain (used for demos / the owner's own account).
  app.post("/v1/onboard", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const config = await getUserConfig(auth.spaceId);
    const structure = [...new Set(config.noteTypes.map((t) => t.folder))];

    const demo = c.req.query("demo") === "1" || c.req.query("demo") === "true";
    if (!demo) {
      return c.json({ seeded: [], structure });
    }

    const existing = await brain.listNotes(auth.spaceId, {
      allowed: allowedVisibilities(auth.scope),
      limit: 1,
    });
    if (existing.length > 0) {
      return c.json({ seeded: [], structure, alreadyHadNotes: true });
    }
    const seeded = await seedTemplateBrain(brain, auth.spaceId);
    return c.json({ seeded, structure, alreadyHadNotes: false });
  });

  // The user's category structure (taxonomy), with stable folder + label.
  app.get("/v1/structure", async (c) => {
    const auth = c.get("auth");
    const config = await getUserConfig(auth.spaceId);
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
    const res = await brain.search(auth.spaceId, q, {
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
    const res = await brain.listNotes(auth.spaceId, {
      allowed,
      types: csv(c.req.query("type")),
      tags: csv(c.req.query("tags")),
      prefix: c.req.query("prefix") || undefined,
      limit: Number.isFinite(limit) ? limit : 200,
    });
    return c.json({ notes: res });
  });

  // Per-pillar note counts (first path segment). Powers the lazy sidebar: the
  // client renders pillars + counts up front and fetches a folder's notes
  // (?prefix=) only when it's expanded.
  app.get("/v1/folders", async (c) => {
    const auth = c.get("auth");
    const folders = await brain.folderCounts(auth.spaceId, allowedVisibilities(auth.scope));
    return c.json({ folders });
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
    const config = await getUserConfig(auth.spaceId);
    // Pass `allowed` so a note can't exceed scope via its type's default visibility.
    const note = await brain.createNote(auth.spaceId, body, config, allowed);
    return c.json({ path: note.path, meta: note.meta }, 201);
  });

  app.get("/v1/notes/:path{.+}", async (c) => {
    const auth = c.get("auth");
    const allowed = allowedVisibilities(auth.scope);
    const note = await brain.readNote(auth.spaceId, c.req.param("path"), allowed);
    return c.json({ path: note.path, meta: note.meta, body: note.body, raw: serializeNote(note.meta, note.body) });
  });

  app.patch("/v1/notes/:path{.+}", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    const patch = await c.req.json();
    const note = await brain.updateNote(auth.spaceId, c.req.param("path"), patch, allowed);
    return c.json({ path: note.path, meta: note.meta });
  });

  app.delete("/v1/notes/:path{.+}", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    await brain.deleteNote(auth.spaceId, c.req.param("path"), allowed);
    return c.json({ deleted: c.req.param("path") });
  });

  app.post("/v1/move", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    const { from, to } = await c.req.json<{ from: string; to: string }>();
    const note = await brain.moveNote(auth.spaceId, from, to, allowed);
    return c.json({ path: note.path, meta: note.meta });
  });

  app.post("/v1/append", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    const { path, text } = await c.req.json<{ path: string; text: string }>();
    const note = await brain.appendToNote(auth.spaceId, path, text, allowed);
    return c.json({ appended: note.path });
  });

  app.post("/v1/link", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const allowed = allowedVisibilities(auth.scope);
    const { a, b } = await c.req.json<{ a: string; b: string }>();
    await brain.linkNotes(auth.spaceId, a, b, allowed);
    return c.json({ linked: [a, b] });
  });

  // Semantic "idea links" for the Brain Map: fuzzy edges between notes that are
  // topically close even when not explicitly linked. Embeds only title+excerpt
  // (never full bodies), respects scope, and caches vectors by content hash.
  app.get("/v1/graph/semantic", async (c) => {
    const auth = c.get("auth");
    if (!embeddingsEnabled()) return c.json({ enabled: false, edges: [] });
    const allowed = allowedVisibilities(auth.scope);
    const notes = await brain.listNotes(auth.spaceId, { allowed, limit: 400 });
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
    const ctx = await brain.getContext(auth.spaceId, topic, allowed, limit ?? 6);
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

  // ── Connections (per-account connector credentials + settings) ────────────
  app.get("/v1/connections", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const provider = c.req.query("provider") ?? undefined;
    const conns = await listConnections(auth.spaceId, provider);
    // Never expose the credential to the browser.
    return c.json({
      connections: conns.map((k) => ({
        id: k.id,
        provider: k.provider,
        status: k.status,
        accountEmail: k.accountEmail,
        accountLabel: k.accountLabel,
        lastSyncAt: k.lastSyncAt,
        lastError: k.lastError,
        settings: k.settings,
        createdAt: k.createdAt,
      })),
    });
  });

  app.delete("/v1/connections/:id", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    await deleteConnection(auth.spaceId, c.req.param("id"));
    return c.json({ deleted: c.req.param("id") });
  });

  // Run a sync for one connection. dryRun=true previews Drive candidates
  // without ingesting; mode=light + lookbackMonths powers historical backfill.
  app.post("/v1/connections/:id/sync", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const body = (await c.req.json().catch(() => ({}))) as {
      mode?: string;
      dryRun?: boolean;
      lookbackMonths?: number;
      batchSize?: number;
    };
    const result = await syncDriveConnection(auth.spaceId, c.req.param("id"), {
      mode: body.mode === "light" ? "light" : "full",
      dryRun: Boolean(body.dryRun),
      lookbackMonths: body.lookbackMonths,
      batchSize: body.batchSize,
    });
    return c.json(result);
  });

  // Start a fire-and-forget server-side run: `light` = historical backfill
  // (people/concepts), `full` = "Sync now" (meeting notes + commitments). Returns
  // immediately; the run is a background loop on the (persistent) server and its
  // progress lives on the connection (settings.backfill), polled via
  // GET /v1/connections. Safe to close the browser — it keeps going.
  app.post("/v1/connections/:id/backfill", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    const body = (await c.req.json().catch(() => ({}))) as {
      lookbackMonths?: number;
      mode?: string;
    };
    const months = Number(body.lookbackMonths ?? 12) || 12;
    const mode = body.mode === "full" ? "full" : "light";
    const state = await startBackfill(auth.spaceId, c.req.param("id"), months, mode);
    return c.json(state);
  });

  // ── Google Drive/Gemini OAuth (Drive read-only for meeting notes) ─────────
  // Start: JWT-guarded, returns the Google consent URL to open.
  app.get("/v1/connectors/google/authorize", async (c) => {
    const auth = c.get("auth");
    requireJwt(auth);
    if (!googleAuthConfigured()) {
      throw new BadRequestError("Google connector is not configured (set GOOGLE_CLIENT_ID/SECRET)");
    }
    // Connect INTO the currently-active space (self or company).
    return c.json({ url: buildAuthorizeUrl(auth.userId, auth.spaceId) });
  });

  // Callback: public (no Authorization header on a browser redirect). Identity
  // is carried + verified via the signed `state`.
  app.get("/connectors/google/callback", async (c) => {
    const webUrl = process.env.PUBLIC_WEB_URL || "http://localhost:3000";
    const redirect = (status: string) =>
      c.redirect(`${webUrl}/app?connector=google-drive-meetings&status=${status}`);
    try {
      const code = c.req.query("code");
      const state = c.req.query("state");
      if (c.req.query("error")) return redirect("denied");
      if (!code || !state) return redirect("error");
      const verified = verifyState(state);
      if (!verified) return redirect("expired");
      const tokens = await exchangeCode(code);
      if (!tokens.refreshToken) {
        // No refresh token means Google didn't grant offline access (already
        // consented). Force re-consent by telling the UI.
        return redirect("no_refresh_token");
      }
      const info = await fetchUserInfo(tokens.accessToken);
      const settings: ConnectionSettings = {
        autoSync: true,
        lookbackMonths: 3,
        keepRaw: false,
        visibility: "private",
      };
      await upsertConnection({
        spaceId: verified.spaceId,
        userId: verified.userId,
        provider: GOOGLE_DRIVE_MEETINGS_PROVIDER,
        credential: tokens.refreshToken,
        accountEmail: info.email || undefined,
        accountLabel: info.name,
        settings,
      });
      return redirect("connected");
    } catch (err) {
      console.error("[google-callback]", err);
      return redirect("error");
    }
  });

  app.post("/v1/connectors/:id/pull", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const connector = getConnector(c.req.param("id"));
    if (!connector) throw new BadRequestError(`unknown connector: ${c.req.param("id")}`);
    const options = await c.req.json().catch(() => ({}));
    const config = await getUserConfig(auth.spaceId);
    const result = await connector.pull(
      { spaceId: auth.spaceId, brain, allowed: allowedVisibilities(auth.scope), config },
      options,
    );
    return c.json(result);
  });

  app.get("/v1/config", async (c) => {
    const auth = c.get("auth");
    return c.json(await getUserConfig(auth.spaceId));
  });

  app.put("/v1/config", async (c) => {
    const auth = c.get("auth");
    requireWrite(auth);
    const raw = await c.req.json();
    return c.json(await setUserConfig(auth.spaceId, raw));
  });

  app.onError((err, c) => {
    if (err instanceof BrainError) return c.json({ error: err.message }, err.status as 400);
    console.error("[api] error:", err);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
