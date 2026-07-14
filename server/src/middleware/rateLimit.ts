import type { Context, MiddlewareHandler } from "hono";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return c.req.header("x-real-ip") ?? "unknown";
}

/**
 * Simple in-memory sliding-window limiter (per Railway instance).
 * Good enough to blunt OAuth spam and expensive endpoint abuse.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (c: Context) => string;
}): MiddlewareHandler {
  const keyFn = opts.key ?? ((c) => clientIp(c));
  return async (c, next) => {
    const now = Date.now();
    const key = `${c.req.path}:${keyFn(c)}`;
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return c.json({ error: "rate limit exceeded" }, 429);
    }
    await next();
  };
}

/** Standalone check for non-Hono handlers (e.g. MCP dispatch). */
export function checkRateLimit(path: string, ip: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const key = `${path}:${ip}`;
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}
