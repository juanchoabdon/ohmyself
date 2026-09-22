// The passage of a note: what matched with its surroundings, not the whole
// document and not its opening. Run with `pnpm --filter @ohmyself/server test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorIn, matchExcerpt, passageBudget, passageOf } from "./passages.js";

const BODY = `# Plan\n\n${"intro ".repeat(300)}\n\n## Pricing\n\nThe price lands at 12 dollars a month and we revisit it in January.\n\n${"tail ".repeat(300)}`;

test("anchorIn finds the chunk inside the body, across different whitespace", () => {
  assert.ok(anchorIn(BODY, "The price lands at 12 dollars") > 0);
  assert.ok(anchorIn(BODY, "The   price\nlands at 12 dollars") > 0);
  assert.equal(anchorIn(BODY, "nothing like this is in the note"), -1);
  assert.equal(anchorIn(BODY, ""), -1);
});

test("the passage carries what matched, not the note's opening", () => {
  const text = passageOf(BODY, "The price lands at 12 dollars", 2_000);
  assert.ok(text.includes("12 dollars a month"));
  assert.ok(text.startsWith("…") && text.endsWith("…"), "says it was cut");
  assert.ok(text.length < BODY.length);
});

test("a note that fits comes back whole", () => {
  assert.equal(passageOf("two lines\nand done", "two", 2_000), "two lines\nand done");
});

test("no recognisable anchor starts at the top instead of coming back empty", () => {
  const text = passageOf(BODY, "none of this exists", 1_200);
  assert.ok(text.startsWith("# Plan"));
});

test("the budget is split across the sources, with a floor and a ceiling", () => {
  assert.equal(passageBudget(6, 14_000), 2_333);
  assert.equal(passageBudget(1, 14_000), 3_000, "ceiling");
  assert.equal(passageBudget(40, 14_000), 700, "floor");
  assert.equal(passageBudget(0), 3_000);
});

test("the lexical excerpt is the piece that matched, not the first 240 chars", () => {
  const excerpt = matchExcerpt(BODY, "pricing dollars");
  assert.ok(excerpt.includes("12 dollars"));
  assert.ok(!excerpt.startsWith("# Plan"));
  assert.ok(matchExcerpt(BODY, "xyzzy").startsWith("# Plan"), "no match falls back to the opening");
  assert.equal(matchExcerpt("", "anything"), "");
});
