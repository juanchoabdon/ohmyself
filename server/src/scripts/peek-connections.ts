import "../env.js";
import { serviceClient } from "../core/supabase.js";

async function main(): Promise<void> {
  const { data, error } = await serviceClient()
    .from("connections")
    .select("id, user_id, provider, account_label, status, last_error, last_sync_at")
    .order("last_sync_at", { ascending: false });
  if (error) throw new Error(error.message);
  for (const c of data ?? []) {
    const r = c as Record<string, unknown>;
    console.log(
      `${String(r.account_label ?? "?")} | ${String(r.provider)} | status=${String(r.status)} | last_sync=${String(r.last_sync_at)}`,
    );
    if (r.last_error) console.log(`   error: ${String(r.last_error).slice(0, 160)}`);
    console.log(`   id=${String(r.id)} space=${String(r.user_id)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
