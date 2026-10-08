/**
 * Link existing ohmyself accounts to their bonds identity (adenda 8).
 *
 * For each `--link <account>=<mxid>` pair, attaches the mxid as the
 * `external_key` of that account's OWN brain and joins the bonds service
 * account as admin, so `POST /v1/spaces { kind: "self", external_key: <mxid> }`
 * from bonds returns that brain instead of creating an empty one. Idempotent:
 * re-running with the same pairs changes nothing; a brain already linked to a
 * DIFFERENT mxid is refused (unlink first with `--unlink <account>`).
 *
 *   cd server && railway run --service ohmyself-api -- pnpm tsx src/scripts/link-bonds-brains.ts \
 *     --link juandi@globa.ai='@juandi:matrix.bonds.chat' \
 *     --link jess@example.com='@jess:matrix.bonds.chat' \
 *     [--service-email bonds-service@ohmyself.ai] [--dry]
 *
 * `<account>` is an email, a @handle or a user id. Nothing is printed that
 * isn't already known to whoever runs it (no tokens).
 */

import "../env.js";
import { serviceClient } from "../core/supabase.js";
import { getSelfLink, linkSelfSpace, unlinkSelfSpace } from "../core/spaces.js";
import { resolveIdentifier } from "../core/users.js";

function argsFor(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) out.push(process.argv[i + 1] as string);
  }
  return out;
}
function argFor(flag: string): string | undefined {
  return argsFor(flag)[0];
}

async function serviceUserId(email: string): Promise<string> {
  const explicit = argFor("--service-user-id");
  if (explicit) return explicit;
  const sb = serviceClient();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  throw new Error(`no service user with email ${email} — run provision-bonds-service.ts first`);
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const links = argsFor("--link");
  const unlinks = argsFor("--unlink");
  if (links.length === 0 && unlinks.length === 0) {
    console.error("usage: --link <email|@handle|id>=<mxid> [--link …] [--unlink <account>] [--dry]");
    process.exit(2);
  }
  const email = argFor("--service-email") ?? "bonds-service@ohmyself.ai";
  const service = await serviceUserId(email);
  console.error(`bonds service account: ${email} (${service})${dry ? " · DRY RUN" : ""}`);

  for (const account of unlinks) {
    const user = await resolveIdentifier(account);
    if (!user) throw new Error(`no account matching '${account}'`);
    const before = await getSelfLink(user.id);
    console.error(`unlink ${account} (${user.id}): ${before ? before.externalKey : "(not linked)"}`);
    if (!dry && before) await unlinkSelfSpace({ userId: user.id, revokeUserId: service });
  }

  for (const pair of links) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error(`--link expects <account>=<mxid>, got '${pair}'`);
    const account = pair.slice(0, eq).trim();
    const mxid = pair.slice(eq + 1).trim();
    if (!/^@[^:\s]+:[^\s]+$/.test(mxid)) throw new Error(`'${mxid}' does not look like a Matrix mxid (@local:server)`);
    const user = await resolveIdentifier(account);
    if (!user) throw new Error(`no account matching '${account}'`);
    const before = await getSelfLink(user.id);
    if (before?.externalKey === mxid) {
      console.error(`= ${account} (${user.id}) already linked to ${mxid}`);
    } else if (before) {
      throw new Error(`${account} is linked to ${before.externalKey}; pass --unlink ${account} first`);
    } else {
      console.error(`+ ${account} (${user.id}) → ${mxid}`);
    }
    if (!dry) await linkSelfSpace({ userId: user.id, externalKey: mxid, grantUserId: service });
  }
  console.error(dry ? "dry run: nothing written" : "done");
}

main().catch((err) => {
  console.error("link failed:", (err as Error).message);
  process.exit(1);
});
