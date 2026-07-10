import { promises as fs } from "node:fs";
import path from "node:path";
import { safeNotePath } from "../paths.js";
import type { Vault } from "./types.js";

/** Local filesystem vault — for dev, Obsidian, and personal Claude over stdio.
 *  Stores files under `<root>/<userId>/<path>`. For single-user local use,
 *  pass a fixed userId (e.g. "local"). */
export class FsVault implements Vault {
  constructor(private root: string) {}

  private abs(userId: string, p: string): string {
    // safeNotePath rejects `..`/absolute paths so a note path can never escape
    // the user's directory and read/write arbitrary host files.
    return path.join(this.root, userId, safeNotePath(p));
  }

  async read(userId: string, p: string): Promise<string | null> {
    try {
      return await fs.readFile(this.abs(userId, p), "utf8");
    } catch {
      return null;
    }
  }

  async write(userId: string, p: string, raw: string): Promise<void> {
    const full = this.abs(userId, p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, raw, "utf8");
  }

  async remove(userId: string, p: string): Promise<void> {
    try {
      await fs.unlink(this.abs(userId, p));
    } catch {
      /* ignore */
    }
  }

  async listPaths(userId: string): Promise<string[]> {
    const base = path.join(this.root, userId);
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.name.endsWith(".md")) out.push(path.relative(base, full));
      }
    };
    await walk(base);
    return out;
  }
}
