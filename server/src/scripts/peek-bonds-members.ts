/** List Bonds space members and probe whether a member can add comments. */
import "../env.js";
import { serviceClient } from "../core/index.js";

const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";

async function main(): Promise<void> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("space_members")
    .select("user_id, role, created_at")
    .eq("space_id", BONDS);
  if (error) throw new Error(error.message);

  console.log(`Bonds members: ${(data ?? []).length}\n`);
  for (const row of (data ?? []) as { user_id: string; role: string; created_at: string }[]) {
    const { data: userData } = await sb.auth.admin.getUserById(row.user_id);
    const u = userData.user;
    const name =
      (u?.user_metadata as { full_name?: string; name?: string } | undefined)?.full_name ||
      (u?.user_metadata as { name?: string } | undefined)?.name ||
      "";
    console.log(`${row.role.padEnd(7)}  ${u?.email ?? "?"}  ${name}`);
    console.log(`         user_id=${row.user_id}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
