/**
 * Apply the stacked-note repair through the deployed API, so the write runs
 * inside the server process: `updateNote` pushes the repaired body into the
 * live Yjs room, converging its lineage. Repairing the vault from outside is
 * not enough — an open room re-stamps its own state over it.
 *
 *   npx tsx src/scripts/repair-stacked-note-live.ts            # inspect
 *   npx tsx src/scripts/repair-stacked-note-live.ts --write    # apply
 */
import "../env.js";
import { serviceClient } from "../core/index.js";

const API = process.env.SMOKE_API ?? "https://www.ohmyself.ai";
const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";
const PATH = "engineering/post-demo-cleanup.md";
const WRITE = process.argv.includes("--write");
const JUNK_HEADINGS = new Set(["## Nueva seccion"]);

async function userToken(): Promise<string> {
  const sb = serviceClient();
  const { data } = await sb
    .from("space_members")
    .select("user_id")
    .eq("space_id", BONDS)
    .eq("role", "owner")
    .limit(1);
  const userId = ((data ?? [])[0] as { user_id: string } | undefined)?.user_id;
  if (!userId) throw new Error("no owner");
  const { data: userData } = await sb.auth.admin.getUserById(userId);
  const email = userData.user?.email;
  if (!email) throw new Error("no email");
  const { data: link } = await sb.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.properties?.hashed_token;
  if (!hashed) throw new Error("no link token");
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_ANON_KEY! },
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  });
  const session = (await res.json()) as { access_token?: string };
  if (!session.access_token) throw new Error("no session");
  return session.access_token;
}

function segments(body: string): string[] {
  const probe = body.slice(0, 120);
  const seams: number[] = [];
  let at = body.indexOf(probe, 1);
  while (at !== -1) {
    seams.push(at);
    at = body.indexOf(probe, at + probe.length);
  }
  const bounds = [0, ...seams, body.length];
  const out: string[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) out.push(body.slice(bounds[i]!, bounds[i + 1]!).trim());
  return out;
}

function headings(md: string): string[] {
  return md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^#{1,6} /.test(l));
}

async function main(): Promise<void> {
  const token = await userToken();
  const headersBase = { Authorization: `Bearer ${token}`, "X-Brain-Space": BONDS };

  const get = await fetch(`${API}/v1/notes/${PATH}`, { headers: headersBase });
  if (!get.ok) throw new Error(`read failed (${get.status})`);
  const note = (await get.json()) as { body: string };
  const body = note.body.replace(/\s+$/, "");
  const parts = segments(body);
  console.log(`live body: ${body.length} chars in ${parts.length} copies`);
  if (parts.length < 2) {
    console.log("already clean — nothing to do");
    return;
  }

  const richest = parts.reduce((a, b) => (b.length > a.length ? b : a));
  const keep = new Set(headings(richest));
  const missing = [...new Set(parts.flatMap(headings))].filter(
    (h) => !keep.has(h) && !JUNK_HEADINGS.has(h),
  );
  if (missing.length) {
    console.error("ABORT — sections only in a discarded copy:", missing);
    process.exit(1);
  }
  const repaired = `${richest.replace(/\s+$/, "")}\n`;
  console.log(`repaired: ${repaired.length} chars, ${headings(repaired).length} sections`);
  console.log("safety check: no section lost");

  if (!WRITE) {
    console.log("\nDRY RUN — re-run with --write to apply");
    return;
  }

  const patch = await fetch(`${API}/v1/notes/${PATH}`, {
    method: "PATCH",
    headers: { ...headersBase, "Content-Type": "application/json" },
    body: JSON.stringify({ body: repaired, summary: "repair note stacked by stale collab lineage" }),
  });
  console.log(`PATCH -> ${patch.status}`);
  if (!patch.ok) {
    console.error(await patch.text());
    process.exit(1);
  }

  // The room debounces its store; confirm the repair survives it.
  for (const wait of [3000, 7000, 15000]) {
    await new Promise((r) => setTimeout(r, wait));
    const check = await fetch(`${API}/v1/notes/${PATH}`, { headers: headersBase });
    const now = (await check.json()) as { body: string };
    const copies = segments(now.body.replace(/\s+$/, "")).length;
    console.log(`  +${wait / 1000}s: ${now.body.length} chars, ${copies} copies`);
    if (copies > 1) {
      console.error("  the room re-stamped its stacked state — lineage still dirty");
      process.exit(1);
    }
  }
  console.log("\nrepair held");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
