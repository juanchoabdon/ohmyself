import "../env.js";
import { buildCore } from "../core/index.js";
import { serviceClient } from "../core/supabase.js";

async function main(): Promise<void> {
  const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const sb = serviceClient();
  const { data } = await sb.from("connections").select("user_id").limit(1);
  const uid = process.env.OHMYSELF_USER_ID ?? (data as { user_id: string }[])?.[0]?.user_id;
  if (!uid) throw new Error("no user");
  const { brain } = buildCore();
  const n = await brain.readNote(uid, `lint/${day}.md`, ["public", "private", "secret"]);
  console.log(n.body);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
