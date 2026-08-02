/**
 * End-to-end smoke test of note comments against the live space: add an
 * anchored comment through the same core path the API and MCP use, then read
 * the threads back and confirm the anchor resolved to the intended span.
 */
import "../env.js";
import {
  addComment,
  allowedVisibilities,
  buildCore,
  listCommentThreads,
  serviceClient,
} from "../core/index.js";

const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";
const PATH = "engineering/post-demo-cleanup.md";

async function ownerId(spaceId: string): Promise<string> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("space_members")
    .select("user_id, role")
    .eq("space_id", spaceId)
    .eq("role", "owner")
    .limit(1);
  if (error) throw new Error(`owner lookup failed: ${error.message}`);
  const row = (data ?? [])[0] as { user_id: string } | undefined;
  if (!row) throw new Error("no owner for space");
  return row.user_id;
}

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const note = await brain.readNote(BONDS, PATH, allowed);

  const marker = "## Purpose";
  const first = note.body.indexOf(marker);
  const second = note.body.indexOf(marker, first + 1);
  console.log(`body: ${note.body.length} chars`);
  console.log(`"${marker}" at ${first} and ${second}`);
  if (second < 0) throw new Error("expected a duplicated section to anchor to");

  const actor = {
    userId: await ownerId(BONDS),
    kind: "agent" as const,
    label: "Cursor",
    isAdmin: true,
  };

  const res = await addComment(brain, BONDS, allowed, actor, {
    path: PATH,
    body:
      "Este documento está duplicado: el cuerpo entero vuelve a empezar aquí, " +
      "después de la sección de decisión del tracker. Las dos copias son idénticas, " +
      "así que la de abajo se puede borrar — pero vale la pena revisar qué write la " +
      "generó, porque si fue un append que reescribió el body completo puede repetirse " +
      "en otras notas del wiki.",
    quote: marker,
    quoteOffset: second,
  });

  console.log(`\nadded ${res.comment.id} (thread ${res.thread}, anchored=${res.anchored})`);
  console.log(`anchor: ${JSON.stringify(res.comment.anchor)}`);

  const threads = await listCommentThreads(brain, BONDS, PATH, allowed);
  console.log(`\nopen threads on the note: ${threads.length}`);
  for (const t of threads) {
    const at = t.match ? `@${t.match.start} (${t.match.how})` : "note-level";
    console.log(`  ${t.id} ${at}${t.orphaned ? " ORPHANED" : ""}`);
    console.log(`    by:    ${t.root.author.label} (${t.root.author.kind})`);
    console.log(`    quote: ${JSON.stringify(t.anchor?.quote ?? null)}`);
    console.log(`    body:  ${t.root.body.slice(0, 90)}...`);
  }

  const mine = threads.find((t) => t.id === res.thread);
  const landed = mine?.match?.start;
  console.log(
    `\nre-resolved to ${landed} — expected ${second} (second copy): ` +
      (landed === second ? "OK" : "MISMATCH"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
