/** Promote a Bonds member to admin so they can edit notes + join collab. */
import "../env.js";
import { serviceClient, updateMemberRole } from "../core/index.js";

const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";
const WHO = process.argv[2] ?? "daniel@bonds.chat";

async function main(): Promise<void> {
  const sb = serviceClient();
  const { data: members } = await sb.from("space_members").select("user_id, role").eq("space_id", BONDS);
  let target: { user_id: string; role: string } | null = null;
  for (const row of (members ?? []) as { user_id: string; role: string }[]) {
    const { data } = await sb.auth.admin.getUserById(row.user_id);
    const email = data.user?.email ?? "";
    const name =
      (data.user?.user_metadata as { full_name?: string; name?: string } | undefined)?.full_name ||
      (data.user?.user_metadata as { name?: string } | undefined)?.name ||
      "";
    if (email === WHO || name.toLowerCase().includes(WHO.toLowerCase()) || row.user_id === WHO) {
      target = row;
      console.log(`found ${email || name} (${row.role})`);
      break;
    }
  }
  if (!target) throw new Error(`no Bonds member matching ${WHO}`);
  if (target.role === "admin" || target.role === "owner") {
    console.log(`already ${target.role}`);
    return;
  }
  await updateMemberRole(BONDS, target.user_id, "admin");
  console.log(`promoted ${WHO} -> admin`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
