import fs from "node:fs/promises";
import path from "node:path";
import type { Visibility } from "../types.js";
import type { HistoryEntry, VersionRecordInput, VersionStore } from "./types.js";

interface StoredVersion extends HistoryEntry {
  visibility: Visibility;
  raw: string | null;
}

/** Local-dev version store: append-only JSON per space. Mirrors the Supabase
 *  contract without requiring Postgres migrations on a laptop. */
export class FsVersionStore implements VersionStore {
  constructor(private baseDir: string) {}

  private spaceDir(spaceId: string): string {
    return path.join(this.baseDir, spaceId);
  }

  private async load(spaceId: string): Promise<StoredVersion[]> {
    const file = path.join(this.spaceDir(spaceId), "versions.json");
    try {
      const raw = await fs.readFile(file, "utf8");
      return JSON.parse(raw) as StoredVersion[];
    } catch {
      return [];
    }
  }

  private async save(spaceId: string, rows: StoredVersion[]): Promise<void> {
    const dir = this.spaceDir(spaceId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "versions.json"), JSON.stringify(rows, null, 2), "utf8");
  }

  async record(spaceId: string, input: VersionRecordInput): Promise<string | null> {
    const rows = await this.load(spaceId);
    const id = rows.length ? Number(rows[rows.length - 1]!.version) + 1 : 1;
    const version = String(id);
    const entry: StoredVersion = {
      version,
      author: input.author,
      timestamp: Math.floor(Date.now() / 1000),
      summary: input.summary ?? `${input.op} ${input.path}`,
      op: input.op,
      path: input.path,
      visibility: input.visibility,
      raw: input.raw,
    };
    rows.push(entry);
    await this.save(spaceId, rows);
    return version;
  }

  async history(
    spaceId: string,
    notePath: string,
    allowed: Visibility[],
    opts?: { limit?: number; offset?: number },
  ): Promise<HistoryEntry[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
    const offset = Math.max(opts?.offset ?? 0, 0);
    const rows = (await this.load(spaceId))
      .filter((r) => r.path === notePath && allowed.includes(r.visibility))
      .sort((a, b) => Number(b.version) - Number(a.version));
    return rows.slice(offset, offset + limit).map(({ visibility: _v, raw: _r, ...e }) => e);
  }

  async readAtVersion(
    spaceId: string,
    notePath: string,
    version: string,
    allowed: Visibility[],
  ): Promise<string | null> {
    const row = (await this.load(spaceId)).find(
      (r) => r.version === version && r.path === notePath && allowed.includes(r.visibility),
    );
    return row?.raw ?? null;
  }

  async recentActivity(
    spaceId: string,
    allowed: Visibility[],
    opts?: { limit?: number },
  ): Promise<HistoryEntry[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 200);
    const rows = (await this.load(spaceId))
      .filter((r) => allowed.includes(r.visibility))
      .sort((a, b) => Number(b.version) - Number(a.version));
    return rows.slice(0, limit).map(({ visibility: _v, raw: _r, ...e }) => e);
  }
}
