import { serviceClient } from "../supabase.js";
import type { Visibility } from "../types.js";
import type { HistoryEntry, VersionOp, VersionRecordInput, VersionStore } from "./types.js";

interface Row {
  id: number;
  path: string;
  title: string;
  visibility: Visibility;
  author: string;
  summary: string | null;
  op: VersionOp;
  raw: string | null;
  created_at: string;
}

function toEntry(r: Row): HistoryEntry {
  return {
    version: String(r.id),
    author: r.author,
    timestamp: Math.floor(new Date(r.created_at).getTime() / 1000),
    summary: r.summary ?? `${r.op} ${r.path}`,
    op: r.op,
    path: r.path,
  };
}

export class SupabaseVersionStore implements VersionStore {
  async record(spaceId: string, input: VersionRecordInput): Promise<string | null> {
    const sb = serviceClient();
    const { data, error } = await sb
      .from("note_versions")
      .insert({
        space_id: spaceId,
        path: input.path,
        title: input.title,
        visibility: input.visibility,
        author: input.author,
        summary: input.summary ?? null,
        op: input.op,
        raw: input.raw,
      })
      .select("id")
      .single();
    if (error) throw new Error(`version record failed: ${error.message}`);
    return data ? String((data as { id: number }).id) : null;
  }

  async history(
    spaceId: string,
    path: string,
    allowed: Visibility[],
    opts?: { limit?: number; offset?: number },
  ): Promise<HistoryEntry[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const offset = Math.max(opts?.offset ?? 0, 0);
    const sb = serviceClient();
    const { data, error } = await sb
      .from("note_versions")
      .select("id, path, title, visibility, author, summary, op, raw, created_at")
      .eq("space_id", spaceId)
      .eq("path", path)
      .in("visibility", allowed)
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error || !data) return [];
    return (data as Row[]).map(toEntry);
  }

  async readAtVersion(
    spaceId: string,
    path: string,
    version: string,
    allowed: Visibility[],
  ): Promise<string | null> {
    const id = Number(version);
    if (!Number.isFinite(id) || id <= 0) return null;
    const sb = serviceClient();
    const { data, error } = await sb
      .from("note_versions")
      .select("raw, visibility")
      .eq("space_id", spaceId)
      .eq("path", path)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { raw: string | null; visibility: Visibility };
    if (!allowed.includes(row.visibility)) return null;
    return row.raw;
  }

  async recentActivity(
    spaceId: string,
    allowed: Visibility[],
    opts?: { limit?: number },
  ): Promise<HistoryEntry[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 200);
    const sb = serviceClient();
    const { data, error } = await sb
      .from("note_versions")
      .select("id, path, title, visibility, author, summary, op, raw, created_at")
      .eq("space_id", spaceId)
      .in("visibility", allowed)
      .order("id", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Row[]).map(toEntry);
  }
}
