import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

let _service: SupabaseClient | null = null;

/** Service-role client. Server-side only — bypasses RLS. The server is the
 *  trusted gateway and always scopes queries by a verified userId. */
export function serviceClient(): SupabaseClient {
  if (_service) return _service;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set");
  }
  _service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node < 22 has no native WebSocket; realtime-js needs one even though we
    // don't use realtime here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  });
  return _service;
}

export function brainBucket(): string {
  return process.env.BRAIN_BUCKET ?? "brain";
}

/** Public bucket for space logos — served openly so the switcher/public agent
 *  can render them without an auth token. */
export function logoBucket(): string {
  return process.env.LOGO_BUCKET ?? "space-logos";
}
