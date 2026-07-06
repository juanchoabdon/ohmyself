/** Small shared OpenAI chat-completion helper (non-streaming). Used by the
 *  cached intro greeting and by the follow-up-questions generator — both of
 *  which want a single finished string, not a token stream. */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 30000;
const MAX_OUTPUT_TOKENS = 700;

export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

/** One non-streaming OpenAI call with a hard timeout. */
export async function completeOnce(
  messages: ModelMessage[],
  opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
): Promise<string | null> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), opts?.timeoutMs ?? OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: opts?.temperature ?? 0.7,
        max_tokens: opts?.maxTokens ?? MAX_OUTPUT_TOKENS,
        presence_penalty: 0.2,
      }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    return text && text.trim() ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/** Complete with one retry (handles a transient upstream hiccup). */
export async function complete(messages: ModelMessage[]): Promise<string | null> {
  const first = await completeOnce(messages);
  if (first) return first;
  return completeOnce(messages);
}
