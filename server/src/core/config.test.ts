// The personal pillars (identity/, journal/, memory/, projects/…) mean
// something only in a personal brain; a company wiki refuses them. `memory/`
// is special: no taxonomy declares it, yet it is THE personal folder.
// Run with `pnpm --filter @ohmyself/server test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_COMPANY_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_RELATIONSHIP_CONFIG,
  isPersonalBrain,
  undeclaredPillar,
} from "./config.js";

test("a personal brain on the default taxonomy accepts its memory log", () => {
  assert.ok(isPersonalBrain(DEFAULT_CONFIG));
  assert.equal(undeclaredPillar(DEFAULT_CONFIG, "memory/log.md"), null);
  assert.equal(undeclaredPillar(DEFAULT_CONFIG, "identity/about-me.md"), null);
  assert.equal(undeclaredPillar(DEFAULT_CONFIG, "journal/2026/2026-01-05.md"), null);
});

test("a company wiki refuses every personal pillar, memory included", () => {
  assert.ok(!isPersonalBrain(DEFAULT_COMPANY_CONFIG));
  assert.equal(undeclaredPillar(DEFAULT_COMPANY_CONFIG, "memory/log.md"), "memory");
  assert.equal(undeclaredPillar(DEFAULT_COMPANY_CONFIG, "identity/about-me.md"), "identity");
  assert.equal(undeclaredPillar(DEFAULT_COMPANY_CONFIG, "projects/x/_index.md"), "projects");
  assert.equal(undeclaredPillar(DEFAULT_COMPANY_CONFIG, "people/ana.md"), null, "people/ is declared there");
});

test("a room brain declares memory/ and journal/ itself", () => {
  assert.ok(!isPersonalBrain(DEFAULT_RELATIONSHIP_CONFIG));
  assert.equal(undeclaredPillar(DEFAULT_RELATIONSHIP_CONFIG, "memory/facts.md"), null);
  assert.equal(undeclaredPillar(DEFAULT_RELATIONSHIP_CONFIG, "identity/about-me.md"), "identity");
});
