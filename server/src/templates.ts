import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Brain } from "./core/index.js";
import { TEMPLATE_BRAIN } from "./templates.generated.js";

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

/** Read the default template brain from disk (used by local tooling). */
export async function readTemplateBrainFromDisk(): Promise<{ path: string; raw: string }[]> {
  const dir = templatesBrainDir();
  const files = await listMarkdown(dir);
  const out: { path: string; raw: string }[] = [];
  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join("/");
    out.push({ path: rel, raw: await fs.readFile(file, "utf8") });
  }
  return out;
}

/**
 * Import the default template brain into a user. Returns imported paths.
 *
 * Uses the embedded template brain (TEMPLATE_BRAIN) so this works in
 * serverless environments without filesystem access to the repo. Set
 * `fromDisk` to read the live `templates/brain` directory instead (handy
 * during local template development).
 */
export async function seedTemplateBrain(
  brain: Brain,
  userId: string,
  opts: { fromDisk?: boolean } = {},
): Promise<string[]> {
  const notes = opts.fromDisk ? await readTemplateBrainFromDisk() : TEMPLATE_BRAIN;
  const imported: string[] = [];
  for (const note of notes) {
    await brain.importRaw(userId, note.path, note.raw);
    imported.push(note.path);
  }
  return imported;
}
