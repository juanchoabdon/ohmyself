/**
 * One-time: provision the bonds machine account (ai-in-chat B2ext).
 *
 * Creates (or reuses) the service user that owns every `relationship` space
 * bonds provisions, mints it an `oms_` API token, and optionally joins it as
 * admin to existing spaces (the B1 spike spaces, so the token swap is atomic).
 *
 * The token prints to STDOUT ONLY (one line, nothing else) so it can be piped
 * straight into a secret store without ever touching a terminal scrollback:
 *
 *   tsx src/scripts/provision-bonds-service.ts --email bonds-service@ohmyself.ai \
 *     --join <spaceId> --join <spaceId> | vercel env add OHMYSELF_TOKEN production
 */

import "../env.js";
import { serviceClient } from "../core/supabase.js";
import { createToken } from "../core/tokens.js";

function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function argsFor(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) out.push(process.argv[i + 1] as string);
  }
  return out;
}

async function main(): Promise<void> {
  const email = argFor("--email") ?? "bonds-service@ohmyself.ai";
  const name = argFor("--name") ?? "bonds service";
  const joins = argsFor("--join");
  const sb = serviceClient();

  // Reuse the account when it exists (idempotent re-runs mint a fresh token).
  let userId: string | null = null;
  for (let page = 1; page <= 20 && !userId; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    userId = data.users.find((u) => u.email === email)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    const { data, error } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name, machine: true },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    userId = data.user.id;
    console.error(`created service user ${email} (${userId})`);
  } else {
    console.error(`reusing service user ${email} (${userId})`);
  }

  for (const spaceId of joins) {
    const { error } = await sb
      .from("space_members")
      .upsert({ space_id: spaceId, user_id: userId, role: "admin" }, { onConflict: "space_id,user_id" });
    if (error) throw new Error(`join ${spaceId}: ${error.message}`);
    console.error(`joined space ${spaceId} as admin`);
  }

  const { token } = await createToken(userId, "bonds-service", "secret");
  console.error(`minted token 'bonds-service' for ${userId} — value on stdout`);
  process.stdout.write(`${token}\n`);
}

main().catch((err) => {
  console.error("provision failed:", err);
  process.exit(1);
});
