import fs from "node:fs/promises";
import path from "node:path";

export function argFor(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  if (!next || next.startsWith("-")) return undefined;
  return next;
}

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeFileIfAllowed(
  filePath: string,
  content: string,
  force: boolean,
): Promise<"written" | "skipped"> {
  if (!force && (await pathExists(filePath))) return "skipped";
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
  return "written";
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function mergeJsonFile(
  filePath: string,
  patch: Record<string, unknown>,
  force: boolean,
): Promise<"written" | "skipped" | "merged"> {
  if (!(await pathExists(filePath))) {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, `${JSON.stringify(patch, null, 2)}\n`, "utf8");
    return "written";
  }
  if (!force) return "skipped";
  const existing = (await readJsonFile<Record<string, unknown>>(filePath)) ?? {};
  const merged = deepMerge(existing, patch);
  await fs.writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return "merged";
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof out[k] === "object" &&
      out[k] !== null &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "project"
  );
}

export function defaultMcpUrl(): string {
  return (
    process.env.PUBLIC_API_URL?.replace(/\/+$/, "") ||
    process.env.OMS_ISSUER?.replace(/\/+$/, "") ||
    "https://www.ohmyself.ai"
  ) + "/mcp";
}
