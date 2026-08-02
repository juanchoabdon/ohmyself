/**
 * Verify (and where possible repair) what the media feature needs in Supabase:
 * the private `note-assets` bucket and the `note_assets` table.
 *
 * The bucket can be created with the service role. The table is DDL, which only
 * the SQL editor or a direct Postgres connection can run — so this reports it
 * rather than pretending it can fix it.
 *
 *   npx tsx src/scripts/check-media-setup.ts
 */
import "../env.js";
import { serviceClient, assetBucket } from "../core/supabase.js";

const BUCKET_LIMIT = 50 * 1024 * 1024;

async function main() {
  const sb = serviceClient();
  const bucket = assetBucket();
  let ready = true;

  const { data: existing } = await sb.storage.getBucket(bucket);
  if (!existing) {
    const { error } = await sb.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: BUCKET_LIMIT,
    });
    if (error) {
      console.log(`FAIL  bucket '${bucket}' missing and could not be created — ${error.message}`);
      ready = false;
    } else {
      console.log(`ok    bucket '${bucket}' created (private, 50 MB limit)`);
    }
  } else if (existing.public) {
    console.log(`FAIL  bucket '${bucket}' is PUBLIC — signed-url privacy is defeated, run the migration`);
    ready = false;
  } else {
    console.log(`ok    bucket '${bucket}' exists and is private`);
  }

  const { error: tableError } = await sb.from("note_assets").select("id").limit(1);
  if (tableError) {
    console.log(`FAIL  table note_assets is not reachable — ${tableError.message}`);
    console.log("      run supabase/migrations/20260801120000_note_assets.sql in the SQL editor");
    ready = false;
  } else {
    console.log("ok    table note_assets is reachable");
  }

  console.log(ready ? "\nmedia backend is ready" : "\nmedia backend is NOT ready");
  process.exit(ready ? 0 : 1);
}

void main();
