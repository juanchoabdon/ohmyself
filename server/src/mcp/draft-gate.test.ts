// The work-doc gate holds a new spec until the owner says yes, and lets the
// owner's already-approved specs change without asking again: updates to an
// approved spec and amendments filed against one (`amends`) write directly.
// Run with `pnpm --filter @ohmyself/server test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { gateWrite, isApproved, isWorkDoc, type GateNote } from "./draft-gate.js";

const SPEC_BODY = "## Por qué\n\nbondi necesita manos que no le mientan.\n".repeat(20);

const APPROVED: GateNote = {
  meta: { type: "spec", title: "bondi: manos con criterio", tags: ["bondi", "approved"] },
  body: "Estado: borrador · 2026-10-22\n\n## Por qué\n",
};

const UNAPPROVED: GateNote = {
  meta: { type: "spec", title: "bondi cuenta lo nuevo", tags: ["bondi", "draft"] },
  body: "Status: draft\n\n## Por qué\n",
};

function wiki(notes: Record<string, GateNote>) {
  return async (path: string) => notes[path] ?? null;
}

const base = { spaceId: "space-1", space: "bonds" };

test("creating a new spec returns a draft preview and a confirm token", async () => {
  const res = await gateWrite(
    { ...base, path: "product/specs/nuevo.md", title: "Nuevo", body: SPEC_BODY, type: "spec" },
    wiki({}),
  );
  assert.equal(res?.status, "draft_pending_confirmation");
  assert.match(res?.confirm_token ?? "", /^draft_/);
});

test("the confirm token from that preview lets the same create through", async () => {
  const req = { ...base, path: "product/specs/nuevo.md", title: "Nuevo", body: SPEC_BODY, type: "spec" };
  const preview = await gateWrite(req, wiki({}));
  assert.equal(await gateWrite({ ...req, confirmToken: preview?.confirm_token }, wiki({})), null);
});

test("creating an amendment to an approved spec writes directly", async () => {
  const res = await gateWrite(
    {
      ...base,
      path: "product/specs/bondi-manos-enmienda-a.md",
      title: "Enmienda A",
      body: SPEC_BODY,
      type: "spec",
      amends: "product/specs/bondi-manos-con-criterio.md",
    },
    wiki({ "product/specs/bondi-manos-con-criterio.md": APPROVED }),
  );
  assert.equal(res, null);
});

test("an amendment to a spec that is missing or not approved stays gated", async () => {
  const req = {
    ...base,
    path: "product/specs/enmienda.md",
    title: "Enmienda",
    body: SPEC_BODY,
    type: "spec",
  };
  const missing = await gateWrite({ ...req, amends: "product/specs/no-existe.md" }, wiki({}));
  assert.equal(missing?.status, "draft_pending_confirmation");
  const unapproved = await gateWrite(
    { ...req, amends: "product/specs/bondi-cuenta-lo-nuevo.md" },
    wiki({ "product/specs/bondi-cuenta-lo-nuevo.md": UNAPPROVED }),
  );
  assert.equal(unapproved?.status, "draft_pending_confirmation");
});

test("updating or appending to an approved spec writes directly", async () => {
  const notes = wiki({ "product/specs/bondi-manos-con-criterio.md": APPROVED });
  const req = { ...base, path: "product/specs/bondi-manos-con-criterio.md", body: SPEC_BODY };
  assert.equal(await gateWrite(req, notes), null);
  assert.equal(await gateWrite({ ...req, append: true }, notes), null);
});

test("updating a spec that is not approved stays gated", async () => {
  const res = await gateWrite(
    { ...base, path: "product/specs/bondi-cuenta-lo-nuevo.md", body: SPEC_BODY },
    wiki({ "product/specs/bondi-cuenta-lo-nuevo.md": UNAPPROVED }),
  );
  assert.equal(res?.status, "draft_pending_confirmation");
  assert.equal(res?.destination.action, "overwrite");
});

test("a spec index is navigation, never gated", async () => {
  assert.equal(isWorkDoc({ path: "product/specs/_index.md" }), false);
  assert.equal(isWorkDoc({ type: "index", path: "product/specs/releases/_index.md" }), false);
  const res = await gateWrite(
    { ...base, path: "product/specs/_index.md", body: SPEC_BODY },
    wiki({ "product/specs/_index.md": { meta: { type: "index", title: "Specs" }, body: "" } }),
  );
  assert.equal(res, null);
});

test("approval reads the tag, the frontmatter status, or the Document control line", () => {
  assert.ok(isApproved({ tags: ["approved"] }));
  assert.ok(isApproved({ extra: { status: "Approved" } }));
  assert.ok(isApproved({ body: "Status: approved · rev 145850" }));
  assert.ok(isApproved({ body: "## Document control\n\n| Status | **approved** |" }));
  assert.ok(isApproved({ body: "**Estado:** aprobada (JD 2026-10-22)" }));
  assert.ok(!isApproved({ tags: ["draft"], body: "Estado: borrador" }));
  assert.ok(!isApproved({ body: "La spec quedará approved cuando JD la lea." }));
});
