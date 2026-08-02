/**
 * Verify comment realtime against the deployed API: open /v1/events as a real
 * user, POST a comment, and assert the SSE frame arrives. The event bus is
 * in-process, so this only proves anything when both the stream and the write
 * hit the same server — which is the point.
 */
import "../env.js";
import { serviceClient } from "../core/index.js";

const API = process.env.SMOKE_API ?? "https://www.ohmyself.ai";
const BONDS = "1315727f-5d16-47e1-8c14-93080dd6882e";
const PATH = "engineering/post-demo-cleanup.md";

/** Mint a real user session with the service role — no password needed. */
async function userToken(): Promise<{ token: string; email: string }> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("space_members")
    .select("user_id")
    .eq("space_id", BONDS)
    .eq("role", "owner")
    .limit(1);
  if (error) throw new Error(`owner lookup failed: ${error.message}`);
  const userId = ((data ?? [])[0] as { user_id: string } | undefined)?.user_id;
  if (!userId) throw new Error("no owner");

  const admin = sb.auth.admin;
  const { data: userData, error: userErr } = await admin.getUserById(userId);
  if (userErr || !userData.user?.email) throw new Error(`no email for ${userId}`);
  const email = userData.user.email;

  const { data: link, error: linkErr } = await admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkErr?.message ?? "no token"}`);
  }

  // Raw REST: supabase-js would spin up a realtime client, which needs a
  // WebSocket impl this Node doesn't ship.
  const verify = await fetch(`${process.env.SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ type: "magiclink", token_hash: link.properties.hashed_token }),
  });
  const session = (await verify.json()) as { access_token?: string; error_description?: string };
  if (!session.access_token) {
    throw new Error(`verify failed (${verify.status}): ${session.error_description ?? "no token"}`);
  }
  return { token: session.access_token, email };
}

async function main(): Promise<void> {
  const { token, email } = await userToken();
  console.log(`authenticated as ${email}`);
  console.log(`target: ${API}`);

  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Brain-Space": BONDS,
  };

  const ac = new AbortController();
  const frames: string[] = [];
  let sawComment: Record<string, unknown> | null = null;

  const res = await fetch(`${API}/v1/events`, {
    headers: { ...headers, Accept: "text/event-stream" },
    signal: ac.signal,
  });
  if (!res.ok || !res.body) throw new Error(`events stream failed (${res.status})`);
  console.log(`stream open (${res.status})`);

  const pump = (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let name = "";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) name = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (!name || name === "ping") continue;
        frames.push(name);
        console.log(`  <- ${name} ${data}`);
        if (name.startsWith("comment_")) sawComment = JSON.parse(data);
      }
    }
  })().catch(() => {
    /* aborted */
  });

  // Let the subscription register before writing.
  await new Promise((r) => setTimeout(r, 1500));

  console.log("posting comment...");
  const post = await fetch(`${API}/v1/comments`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      path: PATH,
      body: "Prueba de realtime — este comentario se creó por la API para confirmar que el evento SSE llega a las pestañas abiertas.",
    }),
  });
  const created = (await post.json()) as { comment?: { id: string } };
  console.log(`POST /v1/comments -> ${post.status} (${created.comment?.id ?? "?"})`);

  await new Promise((r) => setTimeout(r, 4000));
  ac.abort();
  await pump;

  console.log(`\nframes received: ${frames.join(", ") || "(none)"}`);
  if (sawComment) {
    console.log(`REALTIME OK — ${JSON.stringify(sawComment)}`);
  } else {
    console.log("REALTIME FAILED — no comment_* frame arrived");
    process.exitCode = 1;
  }

  // Clean up the probe comment so it doesn't linger in the wiki.
  if (created.comment?.id) {
    const del = await fetch(`${API}/v1/comments/${created.comment.id}`, {
      method: "DELETE",
      headers,
    });
    console.log(`cleanup DELETE -> ${del.status}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
