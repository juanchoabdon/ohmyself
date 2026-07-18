/** Audit OpenAI cost drivers: connections, backfills, note counts, tool_usage. */
import "../env.js";
import { serviceClient } from "../core/supabase.js";
import { buildCore, allowedVisibilities, listSelfSpaceIds } from "../core/index.js";

type ConnRow = {
  id: string;
  user_id: string;
  account_label: string | null;
  status: string;
  last_sync_at: string | null;
  settings: Record<string, unknown> | null;
};

async function main(): Promise<void> {
  const sb = serviceClient();
  const { data: conns, error } = await sb
    .from("connections")
    .select("id, user_id, account_label, status, last_sync_at, settings")
    .eq("provider", "google-drive-meetings");
  if (error) throw new Error(error.message);

  const { brain } = buildCore();
  const allowed = allowedVisibilities("secret");
  const selfSpaces = await listSelfSpaceIds();

  console.log("=== CONNECTIONS (google-drive-meetings) ===\n");
  for (const c of (conns ?? []) as ConnRow[]) {
    const s = c.settings ?? {};
    const seenFull = (s.seenFileIds as string[] | undefined)?.length ?? 0;
    const seenLight = (s.seenLightIds as string[] | undefined)?.length ?? 0;
    const bf = s.backfill as Record<string, unknown> | undefined;
    const notes = await brain.listNotes(c.user_id, { prefix: "meetings/", allowed, limit: 100000 });
    const people = await brain.listNotes(c.user_id, { types: ["person"], allowed, limit: 100000 });
    const concepts = await brain.listNotes(c.user_id, { types: ["concept"], allowed, limit: 100000 });

    console.log(`${c.account_label ?? "?"} | space=${c.user_id.slice(0, 8)}… | status=${c.status}`);
    console.log(`  last_sync=${c.last_sync_at ?? "never"}`);
    console.log(`  seenFull=${seenFull} seenLight=${seenLight} | meetings=${notes.length} people=${people.length} concepts=${concepts.length}`);
    if (bf) {
      console.log(
        `  backfill: status=${String(bf.status)} done=${String(bf.done ?? "?")}/${String(bf.total ?? "?")} mode=${String(bf.mode ?? "?")} lookback=${String(bf.lookbackMonths ?? "?")}mo`,
      );
      console.log(`  backfill started=${String(bf.startedAt ?? "?")} lastStep=${String(bf.lastStepAt ?? "?")}`);
      if (bf.current) console.log(`  current: ${String(bf.current).slice(0, 80)}`);
    } else {
      console.log("  backfill: (none)");
    }
    console.log("");
  }

  console.log("=== SELF SPACES ===");
  console.log(`count=${selfSpaces.length}\n`);

  // tool_usage last 7d
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: usage, error: uErr } = await sb
    .from("tool_usage")
    .select("tool, ok, latency_ms, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (uErr) {
    console.log("tool_usage: unavailable —", uErr.message);
  } else {
    const counts = new Map<string, number>();
    for (const r of usage ?? []) {
      const n = (r as { tool: string }).tool;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    console.log("=== MCP tool_usage (last 7d) ===");
    console.log(`total calls=${usage?.length ?? 0}`);
    for (const [tool, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      console.log(`  ${tool}: ${n}`);
    }
    const heavy = ["research_brain", "research_space", "research_friend", "write_brain", "write_space"];
    const heavyTotal = heavy.reduce((s, t) => s + (counts.get(t) ?? 0), 0);
    console.log(`\nheavy LLM tools (research/write): ${heavyTotal} calls`);
  }

  // Recent lint reports
  console.log("\n=== LINT REPORTS (last 7d) ===");
  for (const spaceId of selfSpaces.slice(0, 10)) {
    const lint = await brain.listNotes(spaceId, { prefix: "lint/", allowed, limit: 20 });
    const recent = lint.filter((n) => n.path >= `lint/${since.slice(0, 10)}`.replace(/.$/, "0")); // rough
    if (lint.length) {
      const latest = lint.sort((a, b) => b.path.localeCompare(a.path))[0]!;
      console.log(`  ${spaceId.slice(0, 8)}… latest=${latest.path}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
