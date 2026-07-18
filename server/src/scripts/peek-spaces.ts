import "../env.js";
import { serviceClient } from "../core/supabase.js";

async function main(): Promise<void> {
  const { data, error } = await serviceClient()
    .from("spaces")
    .select("id,slug,name,kind,owner_user_id");
  if (error) throw new Error(error.message);
  for (const s of data ?? []) {
    console.log(
      (s as Record<string, unknown>).slug,
      "|",
      (s as Record<string, unknown>).kind,
      "|",
      (s as Record<string, unknown>).name,
      "|owner:",
      (s as Record<string, unknown>).owner_user_id,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
