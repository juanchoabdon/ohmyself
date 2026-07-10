import "../env.js";
import { serviceClient } from "../core/supabase.js";

async function main(): Promise<void> {
  const sb = serviceClient();

  const { count: spacesCount } = await sb.from("spaces").select("*", { count: "exact", head: true });
  const { data: kinds } = await sb.from("spaces").select("kind");
  const byKind = (kinds ?? []).reduce<Record<string, number>>((m, r: any) => {
    m[r.kind] = (m[r.kind] ?? 0) + 1;
    return m;
  }, {});

  const { count: membersCount } = await sb
    .from("space_members")
    .select("*", { count: "exact", head: true });

  const { count: idxTotal } = await sb.from("note_index").select("*", { count: "exact", head: true });
  const { count: idxNullSpace } = await sb
    .from("note_index")
    .select("*", { count: "exact", head: true })
    .is("space_id", null);

  const { count: cfgTotal } = await sb.from("user_config").select("*", { count: "exact", head: true });
  const { count: cfgNullSpace } = await sb
    .from("user_config")
    .select("*", { count: "exact", head: true })
    .is("space_id", null);

  console.log(JSON.stringify({
    spaces: { total: spacesCount, byKind },
    members: membersCount,
    note_index: { total: idxTotal, nullSpaceId: idxNullSpace },
    user_config: { total: cfgTotal, nullSpaceId: cfgNullSpace },
  }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
