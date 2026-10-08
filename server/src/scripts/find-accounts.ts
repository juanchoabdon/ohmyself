/**
 * Read-only: find ohmyself accounts by name / handle / email fragment, and
 * optionally the auth user id behind an exact email (the bonds service user).
 * Prints one line per hit. Writes nothing.
 *
 *   railway run --service ohmyself-api -- pnpm tsx src/scripts/find-accounts.ts dani sebas jess
 *   railway run --service ohmyself-api -- pnpm tsx src/scripts/find-accounts.ts --auth-email bonds-service@ohmyself.ai
 *   railway run --service ohmyself-api -- pnpm tsx src/scripts/find-accounts.ts --space bonds
 *   railway run --service ohmyself-api -- pnpm tsx src/scripts/find-accounts.ts --linked
 */

import "../env.js";
import { serviceClient } from "../core/supabase.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sb = serviceClient();

  const authIdx = args.indexOf("--auth-email");
  if (authIdx >= 0) {
    const email = args[authIdx + 1];
    if (!email) throw new Error("--auth-email needs an email");
    args.splice(authIdx, 2);
    let found = false;
    for (let page = 1; page <= 20 && !found; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`listUsers: ${error.message}`);
      const hit = data.users.find((u) => u.email === email);
      if (hit) {
        console.log(`auth user ${email}: ${hit.id}`);
        found = true;
      }
      if (data.users.length < 200) break;
    }
    if (!found) console.log(`auth user ${email}: NOT FOUND`);
  }

  // --linked: every self brain carrying an external_key (bonds mxid), with who
  // owns it and who was granted in — the audit after link-bonds-brains.ts.
  const linkedIdx = args.indexOf("--linked");
  if (linkedIdx >= 0) {
    args.splice(linkedIdx, 1);
    const { data, error } = await sb
      .from("spaces")
      .select("id,kind,name,owner_user_id,external_key")
      .eq("kind", "self")
      .not("external_key", "is", null)
      .order("name");
    if (error) throw new Error(`spaces: ${error.message}`);
    const rows = (data ?? []) as { id: string; name: string; owner_user_id: string; external_key: string }[];
    console.log(`${rows.length} linked/provisioned self brain(s)`);
    for (const s of rows) {
      const human = s.id === s.owner_user_id;
      const { data: members } = await sb.from("space_members").select("user_id,role").eq("space_id", s.id);
      const grants = ((members ?? []) as { user_id: string; role: string }[])
        .filter((m) => m.user_id !== s.owner_user_id)
        .map((m) => `${m.role}:${m.user_id}`)
        .join(", ");
      console.log(
        `  ${human ? "linked " : "machine"}  ${s.external_key}  →  ${s.name} (${s.id})${grants ? `  granted: ${grants}` : "  granted: nobody"}`,
      );
    }
  }

  // --space <slug|name|id>: the members of a space, with the email behind each
  // account (from auth.users, so it works even when the profile is bare).
  const spaceIdx = args.indexOf("--space");
  if (spaceIdx >= 0) {
    const key = args[spaceIdx + 1];
    if (!key) throw new Error("--space needs a slug, name or id");
    args.splice(spaceIdx, 2);
    const { data: spaces, error: sErr } = await sb
      .from("spaces")
      .select("id,kind,name,slug")
      .or(`id.eq.${/^[0-9a-f-]{36}$/i.test(key) ? key : "00000000-0000-0000-0000-000000000000"},slug.ilike.%${key}%,name.ilike.%${key}%`);
    if (sErr) throw new Error(`spaces: ${sErr.message}`);
    for (const s of (spaces ?? []) as { id: string; kind: string; name: string; slug: string | null }[]) {
      console.log(`space ${s.name} (${s.kind}, slug=${s.slug ?? "-"}, id=${s.id})`);
      const { data: members, error: mErr } = await sb
        .from("space_members")
        .select("user_id,role")
        .eq("space_id", s.id);
      if (mErr) throw new Error(`members: ${mErr.message}`);
      for (const m of (members ?? []) as { user_id: string; role: string }[]) {
        const { data: prof } = await sb
          .from("profiles")
          .select("email,display_name,username")
          .eq("id", m.user_id)
          .maybeSingle();
        const { data: au } = await sb.auth.admin.getUserById(m.user_id);
        const p = (prof ?? {}) as { email?: string | null; display_name?: string | null; username?: string | null };
        console.log(
          `  ${m.role.padEnd(6)} ${m.user_id}  auth=${au?.user?.email ?? "-"}  profile=${p.email ?? "-"} ${p.display_name ?? "-"} @${p.username ?? "-"}`,
        );
      }
    }
  }

  for (const q of args) {
    const { data, error } = await sb
      .from("profiles")
      .select("id,email,display_name,username")
      .or(`display_name.ilike.%${q}%,username.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(20);
    if (error) throw new Error(`profiles: ${error.message}`);
    const rows = (data ?? []) as { id: string; email: string | null; display_name: string | null; username: string | null }[];
    console.log(`"${q}": ${rows.length} match(es)`);
    for (const r of rows) {
      console.log(`  ${r.id}  ${r.email ?? "-"}  ${r.display_name ?? "-"}  @${r.username ?? "-"}`);
    }
  }
}

main().catch((err) => {
  console.error("find-accounts failed:", (err as Error).message);
  process.exit(1);
});
