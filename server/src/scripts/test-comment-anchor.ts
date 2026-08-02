/**
 * Comment anchors survive edits around them.
 *
 * Run: npx tsx src/scripts/test-comment-anchor.ts
 *
 * Comments store a quote, not a position, so the interesting question isn't
 * "does indexOf work" — it's whether a thread still lands on the right sentence
 * after someone rewrites the paragraph above it, reformats the quote, or moves
 * it to another section, and whether it correctly gives up when the text is
 * genuinely gone.
 */
import { buildAnchor, resolveAnchor } from "../core/anchor.js";

const BODY = `## Context

We decided to ship the comment layer before the mobile app because feedback
loops matter more than reach right now.

## Risks

The anchor can drift if the note is rewritten wholesale. That's acceptable —
threads degrade to orphans instead of pointing at the wrong sentence.

## Notes

Feedback loops matter more than reach right now, and that's the whole bet.
`;

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const QUOTE = "feedback\nloops matter more than reach right now";
const anchor = buildAnchor(BODY, QUOTE);

if (!anchor) {
  console.error("FAIL  could not build the base anchor — nothing else can pass");
  process.exit(1);
}

check("builds an anchor with context", Boolean(anchor.prefix && anchor.suffix));

// 1. Untouched note: exact hit at the recorded offset.
{
  const match = resolveAnchor(BODY, anchor);
  check("unchanged note resolves exactly", match?.how === "exact", match?.how);
}

// 2. Text inserted above shifts every offset — context must carry it.
{
  const edited = `# Title\n\nA new opening paragraph that did not exist before.\n\n${BODY}`;
  const match = resolveAnchor(edited, anchor);
  check(
    "survives insertion above",
    Boolean(match) && edited.slice(match!.start, match!.end).includes("loops matter"),
    match?.how,
  );
}

// 3. The quote itself gets reformatted (bolded, rewrapped).
{
  const edited = BODY.replace(
    "feedback\nloops matter more than reach right now",
    "**feedback loops matter more than reach right now**",
  );
  const match = resolveAnchor(edited, anchor);
  check(
    "survives bold + rewrap of the quoted span",
    Boolean(match) && edited.slice(match!.start, match!.end).includes("loops matter"),
    match?.how,
  );
}

// 4. Duplicate text elsewhere: the nearest occurrence to the original wins.
{
  const match = resolveAnchor(BODY, anchor);
  const secondOccurrence = BODY.indexOf("Feedback loops matter more than reach");
  check(
    "prefers the original occurrence over a later duplicate",
    Boolean(match) && match!.start < secondOccurrence,
    `start=${match?.start} duplicate=${secondOccurrence}`,
  );
}

// 5. Whole section moved to the bottom: no context match, quote match saves it.
{
  const section = "We decided to ship the comment layer before the mobile app because feedback\nloops matter more than reach right now.";
  const edited = `${BODY.replace(section, "(moved)")}\n\n## Appendix\n\n${section}\n`;
  const match = resolveAnchor(edited, anchor);
  check(
    "follows the quote when its section moves",
    Boolean(match) && edited.slice(match!.start, match!.end).includes("loops matter"),
    match?.how,
  );
}

// 6. Quote deleted: must orphan, never guess.
{
  const edited = BODY.replace(
    "We decided to ship the comment layer before the mobile app because feedback\nloops matter more than reach right now.",
    "We shelved the whole idea.",
  ).replace("Feedback loops matter more than reach right now, and that's the whole bet.", "Nothing here.");
  const match = resolveAnchor(edited, anchor);
  check("orphans when the text is gone", match === null, match ? `matched ${match.how}` : undefined);
}

// 7. An agent quoting with sloppy whitespace still anchors.
{
  const built = buildAnchor(BODY, "  feedback   loops matter more   than reach right now  ");
  check("tolerates sloppy whitespace from an agent", Boolean(built), built?.quote);
}

// 8. A quote that was never in the note is rejected outright.
{
  const built = buildAnchor(BODY, "we decided to ship the mobile app first");
  check("rejects a quote that isn't in the note", built === null);
}

console.log(failures === 0 ? "\nall anchor checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
