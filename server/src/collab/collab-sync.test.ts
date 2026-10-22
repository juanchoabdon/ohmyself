/**
 * The vault write must survive the collab push (2026-10-22: every REST/MCP
 * PATCH to a note nobody had open was reverted within a second by a "live
 * edit" that wrote the stale Y state back).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startCollabServer, vaultContentIsNewer } from "./index.js";
import { pushBodyToCollab } from "./sync.js";

test("vaultContentIsNewer compares exact times, not calendar days", () => {
  // Same day, vault written after the last Y save: the vault is newer.
  assert.equal(vaultContentIsNewer("2026-10-22T03:40:12.300Z", "2026-10-22T03:40:11.900Z"), true);
  assert.equal(vaultContentIsNewer("2026-10-22T03:40:11.000Z", "2026-10-22T03:40:12.000Z"), false);
  assert.equal(vaultContentIsNewer(null, "2026-10-22T03:40:12.000Z"), false);
  assert.equal(vaultContentIsNewer("2026-10-22T03:40:12.000Z", null), false);
  assert.equal(vaultContentIsNewer("nope", "2026-10-22T03:40:12.000Z"), false);
});

test("a push to a note nobody has open does not load the room", async () => {
  process.env.COLLAB_ENABLED = "true";
  const server = startCollabServer();
  assert.ok(server);
  const result = await pushBodyToCollab("space-1", "memory/rituales.md", "new body", "old body");
  assert.equal(result, "skipped_no_room");
  // Nothing was loaded: no direct connection, so no store hook can write back.
  assert.equal(server.documents.size, 0);
});
