import { BadRequestError } from "./errors.js";

/**
 * Validate + normalize a note path before it ever touches a vault key.
 *
 * The server talks to Storage/the filesystem with the service role (which
 * bypasses RLS), so multi-tenant isolation depends entirely on the path
 * staying *inside* `<userId>/`. A path containing `..`, an absolute root, a
 * backslash, a Windows drive, or a NUL byte could otherwise traverse out of the
 * user's prefix and read/write another tenant's notes (or arbitrary host files
 * under the `fs` backend). We reject all of those rather than trying to repair
 * them, and return the cleaned relative path.
 */
export function safeNotePath(input: string): string {
  if (typeof input !== "string") throw new BadRequestError("note path is required");
  const clean = input.trim().replace(/^\/+/, "");
  if (!clean) throw new BadRequestError("note path is required");
  if (clean.includes("\u0000")) throw new BadRequestError("invalid note path");
  if (clean.includes("\\")) throw new BadRequestError("invalid note path");
  if (/^[a-zA-Z]:/.test(clean)) throw new BadRequestError("invalid note path");
  const segments = clean.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new BadRequestError("invalid note path");
  }
  return clean;
}
