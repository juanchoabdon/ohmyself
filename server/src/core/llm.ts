/**
 * Thin LLM client + model routing for the Brain's reasoning tools
 * (research_brain, write_brain).
 *
 * Reuses the same OPENAI_API_KEY as embeddings/distill — no new provider. The
 * point of this module is TIERED MODEL ROUTING: cheap+fast models for routing/
 * planning ("Luna"), a capable model for research synthesis ("Terra"), and a
 * heavy model for escalation on hard/low-coverage questions ("Sol"). The tier→
 * model mapping is an implementation detail, fully overridable via env so we can
 * move models without touching call sites.
 */

/** Reasoning tiers, from cheapest/fastest to heaviest. */
export type ModelTier = "route" | "research" | "escalate";

const apiKey = () => process.env.OPENAI_API_KEY ?? "";

/** Base model shared by every tier unless a tier is overridden. */
const BASE_MODEL = () => process.env.OPENAI_MODEL || "gpt-4o-mini";

/** Resolve a tier to a concrete model id. Each tier has its own env override so
 *  the mapping can be retuned in prod without a code change. */
export function modelForTier(tier: ModelTier): string {
  switch (tier) {
    case "route":
      return process.env.OHMY_MODEL_ROUTE || BASE_MODEL();
    case "research":
      return process.env.OHMY_MODEL_RESEARCH || BASE_MODEL();
    case "escalate":
      return (
        process.env.OHMY_MODEL_ESCALATE ||
        process.env.OHMY_MODEL_RESEARCH ||
        // Escalation defaults a notch heavier than the base when unset.
        process.env.OPENAI_MODEL_HEAVY ||
        "gpt-4o"
      );
  }
}

export function llmEnabled(): boolean {
  return Boolean(apiKey());
}

interface ChatOpts {
  tier: ModelTier;
  system: string;
  user: string;
  /** Default 0 (deterministic). */
  temperature?: number;
  /** Per-call timeout; defaults to 45s. */
  timeoutMs?: number;
  /** Ask the provider for a JSON object response. */
  json?: boolean;
}

async function chat(opts: ChatOpts): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), opts.timeoutMs ?? 45000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelForTier(opts.tier),
        temperature: opts.temperature ?? 0,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/** Free-text completion. Returns null if the model is unavailable/failed. */
export async function chatText(opts: Omit<ChatOpts, "json">): Promise<string | null> {
  return chat({ ...opts, json: false });
}

/** JSON completion, parsed. Returns null on any failure (never throws) so the
 *  caller can degrade gracefully. */
export async function chatJSON<T = unknown>(opts: Omit<ChatOpts, "json">): Promise<T | null> {
  const raw = await chat({ ...opts, json: true });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Some models wrap JSON in prose/fences; salvage the first object.
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
