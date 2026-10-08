// Brains provisioned by machine (bonds ai-in-chat, adenda 8 / W-S1): a service
// token creates a `self` space keyed by the person's mxid, pushes their day's
// transcript into its inbox, and the journal job turns it into a personal
// journal. No Supabase, no OpenAI: the service client is an in-memory fake,
// the vault is on disk in a temp dir, and the model is a local HTTP stub.
// Run with `pnpm --filter @ohmyself/server test`.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const scratch = await mkdtemp(path.join(tmpdir(), "oms-self-m2m-"));
process.env.VAULT_BACKEND = "fs";
process.env.FS_VAULT_DIR = path.join(scratch, "vault");
process.env.VERSIONS_DIR = path.join(scratch, "versions");
process.env.OPENAI_API_KEY = "test-key";
delete process.env.OMS_ENFORCE_PRO;
delete process.env.PUBLIC_AGENT_TOKEN;

// ── A model that answers the shape each keeper expects ──────────────────────
const PERSONAL_DAY = {
  worth_keeping: true,
  headline: "Juandi decidió correr la media maratón de Bogotá",
  summary: "Juandi habló con Vale del plan de entrenamiento y quedó en inscribirse esta semana.",
  moments: ["Vale le mandó el plan de 12 semanas", "Quedaron de correr el domingo"],
  decisions: [{ text: "Inscribirse en la media maratón de Bogotá", kind: "decided" }],
  open_threads: ["Comprar tenis nuevos antes del domingo"],
  memory_facts: [{ fact: "Entrena para la media maratón de Bogotá con su hermana Vale", kind: "said" }],
};
const ROOM_DAY = {
  worth_keeping: true,
  headline: "Planearon el viaje a Roma",
  summary: "Jess y Juandi fijaron fechas para Roma.",
  moments: ["Jess propuso la primera semana de noviembre"],
  decisions: [{ text: "Viajar a Roma en noviembre", kind: "decided" }],
  open_threads: [],
  memory_facts: [],
  relationship_update: "",
  picture_drop: [],
  group_identity: "",
};

let llm: Server;
let llmCalls: { system: string }[] = [];
before(async () => {
  llm = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
      const system = body.messages.find((m) => m.role === "system")?.content ?? "";
      llmCalls.push({ system });
      const answer = system.includes("shared room") ? ROOM_DAY : PERSONAL_DAY;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
    });
  });
  await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
  const addr = llm.address();
  if (!addr || typeof addr === "string") throw new Error("no llm port");
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${addr.port}/v1`;
});
after(async () => {
  llm?.close();
  await rm(scratch, { recursive: true, force: true });
});

// ── Wiring: fake DB, real app ───────────────────────────────────────────────
const { FakeSupabase } = await import("../test-support/fake-supabase.js");
const { __setServiceClientForTests } = await import("../core/supabase.js");
const db = new FakeSupabase();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
__setServiceClientForTests(db as any);

const { createToken } = await import("../core/tokens.js");
const { createApp } = await import("./app.js");
const { journalTick } = await import("../journal.js");
const { resolveAuth } = await import("../auth.js");
const { buildMcpServer } = await import("../mcp/tools.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const BONDS = randomUUID(); // the bonds service account
const OTHER = randomUUID(); // some other machine account
process.env.BONDS_SERVICE_USER_ID = BONDS;
const app = createApp();
const { token: bondsToken } = await createToken(BONDS, "bonds-service", "secret");
const { token: otherToken } = await createToken(OTHER, "other-service", "secret");

const MXID = "@juandi:bonds.im";

async function call(
  token: string,
  method: string,
  url: string,
  opts: { body?: unknown; space?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.space) headers["x-brain-space"] = opts.space;
  return app.request(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function mcpClient(token: string, space: string) {
  const auth = await resolveAuth({ authorization: `Bearer ${token}`, "x-brain-space": space });
  const server = await buildMcpServer(auth);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return r.content[0]?.text ?? "";
  };
  return { tool, close: () => Promise.all([client.close(), server.close()]) };
}

let selfId = "";

test("provisioning a self brain twice by external_key converges on one space", async () => {
  const first = await call(bondsToken, "POST", "/v1/spaces", {
    body: { kind: "self", external_key: MXID, name: "Juandi" },
  });
  assert.equal(first.status, 201);
  const a = (await first.json()) as {
    space: { id: string; kind: string; externalKey: string; ownerUserId: string };
    created: boolean;
    scaffolded: string[];
    structure: string[];
  };
  assert.equal(a.created, true);
  assert.equal(a.space.kind, "self");
  assert.equal(a.space.externalKey, MXID);
  assert.equal(a.space.ownerUserId, BONDS);
  assert.notEqual(a.space.id, BONDS, "a machine self brain is not the service account's own brain");
  assert.deepEqual(a.scaffolded, ["_index.md", "identity/about-me.md"]);
  for (const pillar of ["identity", "people", "projects", "goals", "journal"]) {
    assert.ok(a.structure.includes(pillar), `personal taxonomy declares ${pillar}/`);
  }
  assert.ok(!a.structure.includes("memory"), "memory/ is a convention, not a declared folder");
  selfId = a.space.id;

  const second = await call(bondsToken, "POST", "/v1/spaces", {
    body: { kind: "self", external_key: MXID, name: "Juandi (renamed by a replay)" },
  });
  assert.equal(second.status, 200);
  const b = (await second.json()) as { space: { id: string }; created: boolean; scaffolded: string[] };
  assert.equal(b.created, false);
  assert.equal(b.space.id, selfId);
  assert.deepEqual(b.scaffolded, [], "the cocina is not rescaffolded");
});

test("an external_key keeps its kind: a mxid cannot be re-provisioned as a room", async () => {
  const res = await call(bondsToken, "POST", "/v1/spaces", {
    body: { kind: "relationship", external_key: MXID, name: "not a room" },
  });
  assert.equal(res.status, 409);
});

test("external_key is required and kind=company stays a human seat", async () => {
  const noKey = await call(bondsToken, "POST", "/v1/spaces", { body: { kind: "self", name: "x" } });
  assert.equal(noKey.status, 400);
  const company = await call(bondsToken, "POST", "/v1/spaces", {
    body: { kind: "company", name: "Acme", external_key: "acme" },
  });
  assert.equal(company.status, 403, "company spaces need a signed-in session, a token is refused");
});

test("the provisioner reads and writes the brain with X-Brain-Space; nobody else can", async () => {
  const mine = await call(bondsToken, "GET", "/v1/notes", { space: selfId });
  assert.equal(mine.status, 200);
  const { notes } = (await mine.json()) as { notes: { path: string }[] };
  assert.deepEqual(
    notes.map((n) => n.path).sort(),
    ["_index.md", "identity/about-me.md"],
  );

  const me = await call(bondsToken, "GET", "/v1/me", { space: selfId });
  const meBody = (await me.json()) as { spaceId: string; role: string; allowed: string[] };
  assert.equal(meBody.spaceId, selfId);
  assert.equal(meBody.role, "owner");
  assert.deepEqual(meBody.allowed, ["public", "private", "secret"]);

  // Another service token: the key is taken, and the space is invisible.
  const steal = await call(otherToken, "POST", "/v1/spaces", {
    body: { kind: "self", external_key: MXID, name: "Juandi" },
  });
  assert.equal(steal.status, 403);
  const peek = await call(otherToken, "GET", "/v1/notes", { space: selfId });
  assert.equal(peek.status, 401);
  const peekOne = await call(otherToken, "GET", "/v1/notes/identity/about-me.md", { space: selfId });
  assert.equal(peekOne.status, 401);
  const push = await call(otherToken, "POST", "/v1/ingest/transcript", {
    space: selfId,
    body: { messages: [{ author: "x", at: "2026-01-05T10:00:00Z", body: "hi" }] },
  });
  assert.equal(push.status, 401);
});

test("the inbox only exists for machine-provisioned brains", async () => {
  // The service account's OWN self brain (no X-Brain-Space) has no external_key.
  const res = await call(bondsToken, "POST", "/v1/ingest/transcript", {
    body: { messages: [{ author: "x", at: "2026-01-05T10:00:00Z", body: "hi" }] },
  });
  assert.equal(res.status, 400);
});

test("B-V0: a transcript pushed into a self brain becomes its journal after the job runs", async () => {
  const messages = [
    { external_id: "$e1", author: "Juandi", at: "2026-01-05T13:02:00Z", body: "Vale, me mandas el plan de 12 semanas?" },
    { external_id: "$e2", author: "Vale", at: "2026-01-05T13:05:00Z", body: "Te lo mando ya. ¿Te inscribes esta semana?" },
    { external_id: "$e3", author: "Juandi", at: "2026-01-05T13:06:00Z", body: "Sí, me inscribo. Corremos el domingo." },
  ];
  const push = await call(bondsToken, "POST", "/v1/ingest/transcript", { space: selfId, body: { messages } });
  assert.equal(push.status, 202);
  assert.deepEqual(await push.json(), { accepted: 3, duplicates: 0 });

  const replay = await call(bondsToken, "POST", "/v1/ingest/transcript", { space: selfId, body: { messages } });
  assert.deepEqual(await replay.json(), { accepted: 0, duplicates: 3 }, "replays dedupe on external_id");

  // A room provisioned alongside: the tick must keep routing rooms to the
  // relationship keeper while the person goes to the personal one.
  const room = await call(bondsToken, "POST", "/v1/spaces", {
    body: { kind: "relationship", external_key: "!room:bonds.im", name: "Jess & Juandi", members: ["Jess", "Juandi"] },
  });
  assert.equal(room.status, 201);
  const roomId = ((await room.json()) as { space: { id: string } }).space.id;
  await call(bondsToken, "POST", "/v1/ingest/transcript", {
    space: roomId,
    body: { messages: [{ external_id: "$r1", author: "Jess", at: "2026-01-05T20:00:00Z", body: "Roma en noviembre?" }] },
  });

  llmCalls = [];
  const tick = await journalTick();
  assert.equal(tick.written, 2);
  assert.equal(tick.skipped, 0);
  const personalCall = llmCalls.find((c) => c.system.includes("person's conversations"));
  assert.ok(personalCall, "the personal keeper distilled the self brain");
  assert.ok(llmCalls.some((c) => c.system.includes("shared room")), "the room keeper distilled the room");

  // The personal journal lives where log_journal writes it.
  const journal = await call(bondsToken, "GET", "/v1/notes/journal/2026/2026-01-05.md", { space: selfId });
  assert.equal(journal.status, 200);
  const j = (await journal.json()) as { meta: { type: string; title: string }; body: string };
  assert.equal(j.meta.type, "journal");
  assert.equal(j.meta.title, "2026-01-05");
  assert.match(j.body, /plan de entrenamiento/);
  assert.match(j.body, /\*\*decided\*\* — Inscribirse en la media maratón/);
  assert.match(j.body, /## Open threads/);

  // Durable facts land in memory/log.md in `remember`'s own format.
  const memory = await call(bondsToken, "GET", "/v1/notes/memory/log.md", { space: selfId });
  assert.equal(memory.status, 200);
  const m = (await memory.json()) as { body: string };
  assert.match(m.body, /^- 2026-01-05 — Entrena para la media maratón de Bogotá con su hermana Vale _\(#keeper #said\)_$/m);

  // The postal points at the freshest day.
  const postal = await call(bondsToken, "GET", "/v1/notes/_index.md", { space: selfId });
  const p = (await postal.json()) as { body: string };
  assert.match(p.body, /\[\[journal\/2026\/2026-01-05\]\]/);
  assert.match(p.body, /Juandi decidió correr/);

  // No living picture in a personal brain; the room got its own journal shape.
  const picture = await call(bondsToken, "GET", "/v1/notes/memory/relationship.md", { space: selfId });
  assert.equal(picture.status, 404);
  const roomJournal = await call(bondsToken, "GET", "/v1/notes/journal/2026-01-05.md", { space: roomId });
  assert.equal(roomJournal.status, 200);

  // Everything digested: a second tick is idle.
  const pending = db.table("transcript_deltas").filter((r) => r.digested_at == null);
  assert.equal(pending.length, 0);
  const again = await journalTick();
  assert.deepEqual(again, { written: 0, skipped: 0 });
});

test("the personal MCP tools work against the brain through X-Brain-Space", async () => {
  const { tool, close } = await mcpClient(bondsToken, selfId);
  try {
    const empty = await tool("who_am_i");
    assert.match(empty, /second self of Juandi/);
    assert.match(empty, /Identity pages exist but are empty/);

    const identity = await tool("update_identity", { body: "Soy Juandi. Vivo en Bogotá y corro media maratón." });
    assert.match(identity, /identity\/about-me\.md/);
    const who = await tool("who_am_i");
    assert.match(who, /Vivo en Bogotá/);

    await tool("log_journal", { entry: "Hoy corrí 10k con Vale.", date: "2026-01-06" });
    const logged = await call(bondsToken, "GET", "/v1/notes/journal/2026/2026-01-06.md", { space: selfId });
    assert.equal(logged.status, 200);

    const remembered = await tool("remember", { text: "Prefiere entrenar en la mañana" });
    assert.match(remembered, /memory\/log\.md/);

    const recalled = await tool("recall", { topic: "maratón" });
    assert.match(recalled, /maratón/);
    const found = await tool("search_brain", { query: "Vale" });
    assert.match(found, /journal\/2026\/2026-01-05/);
  } finally {
    await close();
  }

  // The same tools, from the other account, see nothing.
  await assert.rejects(mcpClient(otherToken, selfId), /not a member/);
});

// ── A person who already has an account keeps THEIR brain as their bonds brain ─
const { createCompanySpace } = await import("../core/spaces.js");

const HUMAN = randomUUID();
const HUMAN_MXID = "@jess:matrix.bonds.chat";
let humanCompanyId = "";

function seedHuman(userId: string, name: string): void {
  // What `handle_new_user` does on signup: a self space whose id IS the user id.
  db.table("spaces").push({ id: userId, kind: "self", slug: null, name, owner_user_id: userId, external_key: null });
  db.table("space_members").push({ space_id: userId, user_id: userId, role: "owner" });
  db.table("profiles").push({ id: userId, email: `${name.toLowerCase()}@example.com`, display_name: name, username: name.toLowerCase() });
}
seedHuman(HUMAN, "Jess");
const humanJwt = db.jwtFor(HUMAN);

test("linking: a human attaches their mxid to their own brain and bonds gets in as admin", async () => {
  const company = await createCompanySpace({ ownerUserId: HUMAN, name: "Jess Co" });
  humanCompanyId = company.id;

  const none = await call(humanJwt, "GET", "/v1/me/links");
  assert.deepEqual(await none.json(), { links: [] });

  const linked = await call(humanJwt, "POST", "/v1/me/links", { body: { provider: "bonds", external_key: HUMAN_MXID } });
  assert.equal(linked.status, 200);
  assert.deepEqual(await linked.json(), {
    link: { provider: "bonds", externalKey: HUMAN_MXID, spaceId: HUMAN },
    serviceGranted: true,
  });
  const again = await call(humanJwt, "POST", "/v1/me/links", { body: { provider: "bonds", external_key: HUMAN_MXID } });
  assert.equal(again.status, 200, "idempotent for the same key");

  const list = await call(humanJwt, "GET", "/v1/me/links");
  assert.deepEqual(await list.json(), { links: [{ provider: "bonds", externalKey: HUMAN_MXID, spaceId: HUMAN }] });

  // A personal token cannot hand the brain to a machine; only a session can.
  const { token: humanToken } = await createToken(HUMAN, "cursor", "secret");
  const viaToken = await call(humanToken, "POST", "/v1/me/links", { body: { external_key: "@x:bonds" } });
  assert.equal(viaToken.status, 403);
  const unknownProvider = await call(humanJwt, "POST", "/v1/me/links", { body: { provider: "slack", external_key: "U1" } });
  assert.equal(unknownProvider.status, 400);
});

test("provisioning kind=self for a linked mxid returns the human's existing brain, never a new one", async () => {
  const res = await call(bondsToken, "POST", "/v1/spaces", {
    body: { kind: "self", external_key: HUMAN_MXID, name: "Jess (from bonds)" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    space: { id: string; kind: string; name: string; ownerUserId: string; externalKey: string };
    created: boolean;
    linked: boolean;
    scaffolded: string[];
    structure: string[];
  };
  assert.equal(body.space.id, HUMAN, "the brain IS the human's self space");
  assert.equal(body.space.ownerUserId, HUMAN, "the human stays the owner");
  assert.equal(body.space.name, "Jess", "the name is not overwritten by the provisioner");
  assert.equal(body.created, false);
  assert.equal(body.linked, true);
  assert.deepEqual(body.scaffolded, [], "a brain that exists is never rescaffolded");
  assert.ok(body.structure.includes("identity"));
  assert.equal(db.table("spaces").filter((r) => r.external_key === HUMAN_MXID).length, 1, "no second space");

  // bonds acts in it as admin with X-Brain-Space…
  const me = await call(bondsToken, "GET", "/v1/me", { space: HUMAN });
  const meBody = (await me.json()) as { spaceId: string; role: string };
  assert.equal(meBody.spaceId, HUMAN);
  assert.equal(meBody.role, "admin");
  const push = await call(bondsToken, "POST", "/v1/ingest/transcript", {
    space: HUMAN,
    body: { messages: [{ external_id: "$h1", author: "Jess", at: "2026-01-07T09:00:00Z", body: "Hoy corro 15k con Vale" }] },
  });
  assert.equal(push.status, 202);
  const tick = await journalTick();
  assert.equal(tick.written, 1);
  const journal = await call(humanJwt, "GET", "/v1/notes/journal/2026/2026-01-07.md");
  assert.equal(journal.status, 200, "the human sees the keeper's journal in their own brain");

  const { tool, close } = await mcpClient(bondsToken, HUMAN);
  try {
    assert.match(await tool("who_am_i"), /second self of Jess/);
    assert.match(await tool("log_journal", { entry: "nota de bonds", date: "2026-01-08" }), /journal\/2026\/2026-01-08\.md/);
  } finally {
    await close();
  }
});

test("a linked brain is one slot: another mxid cannot claim it, and the key cannot be reused", async () => {
  const other = await call(humanJwt, "POST", "/v1/me/links", { body: { external_key: "@jess2:matrix.bonds.chat" } });
  assert.equal(other.status, 409, "already linked to a different key — unlink first");

  const DANI = randomUUID();
  seedHuman(DANI, "Dani");
  const steal = await call(db.jwtFor(DANI), "POST", "/v1/me/links", { body: { external_key: HUMAN_MXID } });
  assert.equal(steal.status, 409, "the key is already another brain's");

  // And provisioning cannot turn a human brain into a room either.
  const asRoom = await call(bondsToken, "POST", "/v1/spaces", {
    body: { kind: "relationship", external_key: HUMAN_MXID, name: "x" },
  });
  assert.equal(asRoom.status, 409);
});

test("the service token only reaches the linked brain — never the person's other spaces", async () => {
  const company = await call(bondsToken, "GET", "/v1/notes", { space: humanCompanyId });
  assert.equal(company.status, 401, "the human's company wiki is not bonds' to read");
  const companyMcp = mcpClient(bondsToken, humanCompanyId);
  await assert.rejects(companyMcp, /not a member/);

  // Nor can another machine account read the linked brain.
  const peek = await call(otherToken, "GET", "/v1/notes", { space: HUMAN });
  assert.equal(peek.status, 401);
  const claim = await call(otherToken, "POST", "/v1/spaces", { body: { kind: "self", external_key: HUMAN_MXID, name: "x" } });
  assert.equal(claim.status, 403);
});

test("unlinking keeps the brain and revokes bonds", async () => {
  const res = await call(humanJwt, "DELETE", "/v1/me/links/bonds");
  assert.equal(res.status, 200);
  assert.deepEqual(await (await call(humanJwt, "GET", "/v1/me/links")).json(), { links: [] });
  const gone = await call(bondsToken, "GET", "/v1/notes", { space: HUMAN });
  assert.equal(gone.status, 401);
  const still = await call(humanJwt, "GET", "/v1/notes/journal/2026/2026-01-07.md");
  assert.equal(still.status, 200, "what the keeper wrote stays with the person");

  // Provisioning that mxid now creates a NEW machine brain (nobody claims it).
  const fresh = await call(bondsToken, "POST", "/v1/spaces", { body: { kind: "self", external_key: HUMAN_MXID, name: "Jess" } });
  assert.equal(fresh.status, 201);
  const f = (await fresh.json()) as { space: { id: string }; linked: boolean };
  assert.notEqual(f.space.id, HUMAN);
  assert.equal(f.linked, false);
});
