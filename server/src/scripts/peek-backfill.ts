import "../env.js";
import { serviceClient } from "../core/supabase.js";

async function main(): Promise<void> {
  const sb = serviceClient();
  const { data } = await sb.from("connections").select("id,last_sync_at,settings").limit(10);
  const now = Date.now();
  for (const c of ((data as unknown[]) ?? []) as Array<{ id: string; last_sync_at?: string; settings?: { backfill?: Record<string, unknown> } }>) {
    const bf = c.settings?.backfill;
    console.log("conn", c.id, "lastSync", c.last_sync_at);
    if (bf) {
      const lastStepAt = bf.lastStepAt as string | undefined;
      const age = lastStepAt ? Math.round((now - Date.parse(lastStepAt)) / 1000) : null;
      console.log(
        "  bf:",
        JSON.stringify({ status: bf.status, mode: bf.mode, done: bf.done, total: bf.total, current: bf.current }),
        "lastStepAgo(s):",
        age,
      );
    }
  }
}

main().then(() => process.exit(0));
