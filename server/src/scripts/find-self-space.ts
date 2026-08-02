import "../env.js";
import { serviceClient, brainBucket } from "../core/supabase.js";

/** Notes live as objects in the brain bucket, not in a table — count the
 *  vault prefix instead so an empty `notes` table doesn't look like an empty
 *  brain. */
async function vaultSize(spaceId: string): Promise<number> {
  const sb = serviceClient();
  const { data } = await sb.storage.from(brainBucket()).list(spaceId, { limit: 1000 });
  return data?.length ?? 0;
}

async function main() {
  const sb = serviceClient();
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const all = users?.users ?? [];
  console.log(`${all.length} users\n`);

  const rows = await Promise.all(
    all.map(async (u) => ({
      id: u.id,
      email: u.email ?? "?",
      entries: await vaultSize(u.id),
    })),
  );

  for (const r of rows.sort((a, b) => b.entries - a.entries)) {
    if (r.entries === 0) continue;
    console.log(`${String(r.entries).padStart(4)} vault entries  ${r.id}  ${r.email}`);
  }
}

void main();
