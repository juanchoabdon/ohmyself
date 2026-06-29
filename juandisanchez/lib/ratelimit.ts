/**
 * Per-IP rate limiting with two windows (per-minute burst + per-day cap).
 *
 * Two backends:
 *   - In-memory (default): good enough for a single instance / low traffic.
 *   - Upstash Redis (optional): set UPSTASH_REDIS_REST_URL + _TOKEN to survive
 *     across serverless instances. Used automatically when configured.
 */

const PER_MIN = Number(process.env.RATE_LIMIT_PER_MINUTE ?? "12") || 12;
const PER_DAY = Number(process.env.RATE_LIMIT_PER_DAY ?? "200") || 200;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export interface RateResult {
  ok: boolean;
  retryAfter: number; // seconds until the caller may retry (0 if ok)
}

// ── In-memory sliding windows ────────────────────────────────────────────────
type Hit = { count: number; reset: number };
const minute = new Map<string, Hit>();
const day = new Map<string, Hit>();

function bump(map: Map<string, Hit>, key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const cur = map.get(key);
  if (!cur || now >= cur.reset) {
    map.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (cur.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((cur.reset - now) / 1000)) };
  }
  cur.count += 1;
  return { ok: true, retryAfter: 0 };
}

// Opportunistic cleanup so the maps don't grow unbounded.
function sweep() {
  const now = Date.now();
  for (const m of [minute, day]) {
    if (m.size < 5000) continue;
    for (const [k, v] of m) if (now >= v.reset) m.delete(k);
  }
}

function memoryLimit(ip: string): RateResult {
  sweep();
  const m = bump(minute, ip, PER_MIN, 60_000);
  if (!m.ok) return m;
  const d = bump(day, ip, PER_DAY, 86_400_000);
  return d;
}

// ── Upstash (atomic INCR + EXPIRE via pipeline) ──────────────────────────────
async function upstashIncr(key: string, ttlSeconds: number): Promise<number | null> {
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(ttlSeconds), "NX"],
      ]),
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { result: unknown }[];
    const count = Number(out?.[0]?.result);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

async function upstashLimit(ip: string): Promise<RateResult> {
  const minWindow = Math.floor(Date.now() / 60_000);
  const dayWindow = Math.floor(Date.now() / 86_400_000);
  const m = await upstashIncr(`rl:m:${ip}:${minWindow}`, 60);
  if (m === null) return memoryLimit(ip); // fail open to memory limiter on Redis error
  if (m > PER_MIN) return { ok: false, retryAfter: 60 - (Math.floor(Date.now() / 1000) % 60) };
  const d = await upstashIncr(`rl:d:${ip}:${dayWindow}`, 86_400);
  if (d === null) return { ok: true, retryAfter: 0 };
  if (d > PER_DAY) return { ok: false, retryAfter: 3600 };
  return { ok: true, retryAfter: 0 };
}

export async function rateLimit(ip: string): Promise<RateResult> {
  if (UPSTASH_URL && UPSTASH_TOKEN) return upstashLimit(ip);
  return memoryLimit(ip);
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
