/** List comment threads on a note and show where each anchor resolves now. */
import "../env.js";
import { allowedVisibilities, buildCore, listCommentThreads } from "../core/index.js";

const SPACE = process.argv[2] ?? "1315727f-5d16-47e1-8c14-93080dd6882e";
const PATH = process.argv[3] ?? "engineering/post-demo-cleanup.md";

async function main(): Promise<void> {
  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const threads = await listCommentThreads(brain, SPACE, PATH, allowed, { includeResolved: true });
  console.log(`${threads.length} thread(s) on ${PATH}\n`);
  for (const t of threads) {
    const where = t.match ? `@${t.match.start} (${t.match.how})` : "note-level";
    console.log(`${t.id}`);
    console.log(`  anchor:   ${JSON.stringify(t.anchor?.quote ?? null)} -> ${where}`);
    console.log(`  orphaned: ${t.orphaned}`);
    console.log(`  by:       ${t.root.author.label} (${t.root.author.kind})`);
    console.log(`  body:     ${t.root.body.slice(0, 100)}...`);
    console.log(`  replies:  ${t.replies.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
