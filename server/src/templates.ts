import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Brain } from "./core/index.js";

export function templatesBrainDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "templates", "brain");
}

async function listMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".md")) out.push(full);
    }
  };
  await walk(dir);
  return out;
}

/** Import the default template brain into a user. Returns imported paths. */
export async function seedTemplateBrain(brain: Brain, userId: string): Promise<string[]> {
  const dir = templatesBrainDir();
  const files = await listMarkdown(dir);
  const imported: string[] = [];
  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join("/");
    const raw = await fs.readFile(file, "utf8");
    await brain.importRaw(userId, rel, raw);
    imported.push(rel);
  }
  return imported;
}
