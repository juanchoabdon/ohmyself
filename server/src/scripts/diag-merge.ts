import "../env.js";
import { buildCore } from "../core/index.js";
import { serviceClient } from "../core/supabase.js";
import { cosine, embedTexts } from "../core/embeddings.js";
import { judgeMerge } from "../lint.js";

const ALLOWED = ["public", "private", "secret"] as const;

async function main(): Promise<void> {
  const q = (process.argv[2] ?? "amalia").toLowerCase();
  const sb = serviceClient();
  const { data } = await sb.from("connections").select("user_id").limit(1);
  const uid = process.env.OHMYSELF_USER_ID ?? (data as { user_id: string }[])?.[0]?.user_id;
  if (!uid) throw new Error("no user");

  const { brain } = buildCore();
  const people = await brain.listNotes(uid, { types: ["person"], allowed: [...ALLOWED], limit: 5000 });
  const hits = people.filter((p) => p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  console.log(`People matching "${q}": ${hits.length}`);
  for (const h of hits) console.log(`  - ${h.path}  ·  "${h.title}"  ·  excerpt: ${(h.excerpt ?? "").slice(0, 80)}`);
  if (hits.length < 2) return;

  const vecs = await embedTexts(hits.map((h) => `${h.title}\n${h.excerpt ?? ""}`));
  console.log("\nPairwise cosine (candidate needs >= 0.82):");
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      if (!vecs[i] || !vecs[j]) {
        console.log(`  ${hits[i]!.title} × ${hits[j]!.title}: (no embedding)`);
        continue;
      }
      const s = cosine(vecs[i]!, vecs[j]!);
      console.log(`  ${hits[i]!.title} × ${hits[j]!.title}: ${s.toFixed(3)} ${s >= 0.82 ? "✅ candidate" : "❌ below threshold"}`);
    }
  }

  // Judge verdict on the first two matches (full bodies).
  const a = await brain.readNote(uid, hits[0]!.path, [...ALLOWED]);
  const b = await brain.readNote(uid, hits[1]!.path, [...ALLOWED]);
  console.log("\nJudge verdict:");
  const hint = `one name is a strict superset of the other ("${a.meta.title}" / "${b.meta.title}") — likely the same person's short vs fuller name.`;
  const v = await judgeMerge(
    "person",
    { title: a.meta.title, body: a.body },
    { title: b.meta.title, body: b.body },
    hint,
  );
  console.log(JSON.stringify(v, null, 2));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
