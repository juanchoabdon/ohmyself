import { NextRequest } from "next/server";
import { recall, introContext, type Recall } from "@/lib/brain";
import {
  PERSON_SHORT_NAME,
  buildSystemPrompt,
  introInstruction,
} from "@/lib/persona";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Input limits (defense against abuse / cost blow-ups).
const MAX_MESSAGES = 24;
const MAX_USER_CHARS = 2000;
const MAX_TOTAL_CHARS = 12000;
const MAX_OUTPUT_TOKENS = 700;

// Timeouts. We call OpenAI WITHOUT streaming (the server↔OpenAI hop is the
// flaky one and a mid-stream stall can hang forever). Then we re-emit the text
// to the browser in small chunks over the reliable client↔server hop, which
// gives a live "typing" feel without the fragility of upstream streaming.
const OPENAI_TIMEOUT_MS = 30000;
const RETRIEVAL_TIMEOUT_MS = 9000;

// Marker that separates the visible reply from the JSON follow-up suggestions
// in the response stream. Null bytes are stripped from all user input, so this
// can never collide with model/user text.
const FOLLOWUP_SENTINEL = "\u0000\u0000FU\u0000\u0000";

type Role = "user" | "assistant";
interface ClientMessage {
  role: Role;
  content: string;
}
interface ChatBody {
  messages?: unknown;
  intro?: boolean;
  lang?: string;
}

function json(status: number, body: unknown, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

/** Keep only well-formed user/assistant turns, trimmed and capped. */
function sanitizeMessages(raw: unknown): ClientMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientMessage[] = [];
  let total = 0;
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const rawContent = (m as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof rawContent !== "string") continue;
    let content = rawContent.replace(/\u0000/g, "").trim();
    if (!content) continue;
    if (content.length > MAX_USER_CHARS) content = content.slice(0, MAX_USER_CHARS);
    total += content.length;
    if (total > MAX_TOTAL_CHARS) break;
    out.push({ role, content });
  }
  return out;
}

function normalizeLang(lang: unknown): "es" | "en" {
  return lang === "es" ? "es" : "en";
}

/** Resolve to empty grounding if retrieval takes too long — never block the reply. */
async function withTimeout(p: Promise<Recall>, ms: number): Promise<Recall> {
  return Promise.race([
    p,
    new Promise<Recall>((resolve) =>
      setTimeout(() => resolve({ text: "", sources: [], links: [] }), ms),
    ),
  ]);
}

/** Safety net against URL hallucination: neutralize any http(s) URL in the reply
 *  that isn't in the allowlist. Keeps the prompt rule honest even if the model
 *  slips. Disallowed inline/markdown links collapse to their label text;
 *  disallowed images and bare/JSON URLs are stripped. */
function sanitizeLinks(reply: string, allowed: Set<string>): string {
  const ok = (raw: string) => {
    const url = raw.replace(/[.,;:!?)]+$/, "");
    return allowed.has(url) || allowed.has(url.replace(/\/$/, ""));
  };
  let out = reply;
  // Markdown images: drop entirely if the URL isn't allowed.
  out = out.replace(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, (m, url) => (ok(url) ? m : ""));
  // Markdown links: keep the visible text, drop the link if URL isn't allowed.
  out = out.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, text, url) =>
    ok(url) ? m : text,
  );
  // Any remaining bare URL (incl. inside JSON "href") not allowed → strip it.
  out = out.replace(/https?:\/\/[^\s)\]}"'<>]+/g, (url) => (ok(url) ? url : ""));
  return out;
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A real URL can still be the WRONG project's link on a card. Enforce that a
 *  card's href belongs to that card's project (matched via the link's source
 *  label); otherwise drop the href so we never mislabel a link. */
function enforceCardOwnership(reply: string, urlToLabel: Map<string, string>): string {
  return reply.replace(/```card[^\n]*\n([\s\S]*?)```/g, (full, inner: string) => {
    try {
      const obj = JSON.parse(inner.trim()) as Record<string, unknown>;
      const href = typeof obj.href === "string" ? obj.href.replace(/\/$/, "") : "";
      if (href) {
        const label = urlToLabel.get(href) ?? "";
        const title = normName(String(obj.title ?? ""));
        const lab = normName(label);
        const matches = lab && title && (lab.includes(title) || title.includes(lab));
        if (!matches) {
          delete obj.href;
          delete obj.cta;
        }
      }
      return "```card\n" + JSON.stringify(obj) + "\n```";
    } catch {
      return full;
    }
  });
}

/** One non-streaming OpenAI call with a hard timeout. */
async function completeOnce(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string | null> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), OPENAI_TIMEOUT_MS);
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
async function complete(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<string | null> {
  const first = await completeOnce(messages);
  if (first) return first;
  return completeOnce(messages);
}

/** Generate 3 short, tappable follow-up questions based on the conversation so
 *  far. Best-effort: returns [] on any failure so it never blocks the reply. */
async function generateFollowups(
  history: ClientMessage[],
  reply: string,
  lang: "es" | "en",
): Promise<string[]> {
  const recent = history
    .slice(-4)
    .map((m) => `${m.role === "user" ? "Visitor" : PERSON_SHORT_NAME}: ${m.content}`)
    .join("\n");
  const convo = `${recent}\n${PERSON_SHORT_NAME}: ${reply}`.slice(-2000);

  const sys =
    lang === "es"
      ? `Generas sugerencias de preguntas de seguimiento para la web personal de ${PERSON_SHORT_NAME}. Devuelve SOLO un array JSON con EXACTAMENTE 3 preguntas cortas (máx ~7 palabras cada una), en español, escritas como las escribiría un visitante curioso refiriéndose a ${PERSON_SHORT_NAME} en tercera persona. Que sean variadas, naturales y que inviten a seguir explorando temas distintos a los ya respondidos. Sin numeración, sin comillas extra, sin texto adicional. Ejemplo de formato: ["¿Qué lo motiva?","¿Cómo empezó en Rappi?","¿Qué hobbies tiene?"]`
      : `You generate follow-up question suggestions for ${PERSON_SHORT_NAME}'s personal website. Return ONLY a JSON array of EXACTLY 3 short questions (max ~7 words each), in English, written as a curious visitor would, referring to ${PERSON_SHORT_NAME} in the third person. Make them varied and natural, nudging toward topics not already answered. No numbering, no extra quotes, no extra text. Format example: ["What drives him?","How did he start at Rappi?","What are his hobbies?"]`;

  const raw = await completeOnce(
    [
      { role: "system", content: sys },
      { role: "user", content: convo },
    ],
    { temperature: 0.85, maxTokens: 120 },
  );
  if (!raw) return [];
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.replace(/\u0000/g, "").trim())
      .filter((q) => q.length > 0 && q.length <= 80)
      .slice(0, 3);
  } catch {
    return [];
  }
}

/** Emit `text` to the client in small chunks for a live typing effect. The
 *  client↔server hop is reliable, so this never stalls the way upstream
 *  streaming can. */
function typeStream(text: string, followups?: Promise<string[]>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Split by code points so multi-unit characters (emoji are surrogate pairs in
  // UTF-16) are never cut mid-character — slicing raw .length would split them
  // into lone surrogates that encode to the replacement char (�).
  const chars = Array.from(text);
  let i = 0;
  const STEP = 6; // code points per tick
  const DELAY_MS = 7;
  // Show the opening instantly so it feels responsive, then animate the rest.
  const HEAD = Math.min(chars.length, 36);
  let headSent = false;
  let tailSent = false;
  return new ReadableStream({
    async pull(controller) {
      if (!headSent) {
        headSent = true;
        if (HEAD > 0) {
          controller.enqueue(encoder.encode(chars.slice(0, HEAD).join("")));
          i = HEAD;
        }
        return;
      }
      if (i < chars.length) {
        controller.enqueue(encoder.encode(chars.slice(i, i + STEP).join("")));
        i += STEP;
        await new Promise((r) => setTimeout(r, DELAY_MS));
        return;
      }
      // Reply fully typed — append follow-up suggestions (if any) and close in
      // the same tick. (Returning without enqueuing OR closing can hang the
      // stream: with no new data the consumer never triggers another pull.)
      if (!tailSent) {
        tailSent = true;
        const fu = followups ? await followups.catch(() => []) : [];
        if (fu.length) {
          controller.enqueue(encoder.encode(FOLLOWUP_SENTINEL + JSON.stringify(fu)));
        }
        controller.close();
        return;
      }
      controller.close();
    },
  });
}

export async function POST(req: NextRequest) {
  // 1) Rate limit per IP.
  const ip = clientIp(req.headers);
  const limit = await rateLimit(ip);
  if (!limit.ok) {
    return json(
      429,
      { error: "Too many requests. Please slow down a moment." },
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  if (!OPENAI_API_KEY) {
    return json(500, { error: "The agent isn't configured yet (missing OPENAI_API_KEY)." });
  }

  // 2) Parse + validate input.
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return json(400, { error: "Invalid request body." });
  }

  const intro = body.intro === true;
  const lang = normalizeLang(body.lang);
  const history = sanitizeMessages(body.messages);

  if (!intro && history.length === 0) {
    return json(400, { error: "Empty message." });
  }

  // 3) Retrieve grounding from the PUBLIC second self (hard-capped).
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const ground = await withTimeout(
    intro ? introContext(PERSON_SHORT_NAME) : recall(lastUser?.content ?? PERSON_SHORT_NAME),
    RETRIEVAL_TIMEOUT_MS,
  );

  // 4) Build the model conversation. The client can never inject a system role.
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: buildSystemPrompt(ground.text, ground.links) },
  ];
  if (intro) {
    messages.push({ role: "user", content: introInstruction(lang) });
  } else {
    for (const m of history) messages.push({ role: m.role, content: m.content });
  }

  // 5) Get the reply (non-streaming + retry), then type it out to the client.
  const rawReply = await complete(messages);
  if (!rawReply) {
    return json(502, { error: "The agent had a hiccup. Please try again." });
  }

  // Strip any URL the model may have invented despite the allowlist rule, then
  // make sure each card's link actually belongs to that card's project.
  const allowed = new Set(ground.links.map((l) => l.url.replace(/\/$/, "")));
  const urlToLabel = new Map(ground.links.map((l) => [l.url.replace(/\/$/, ""), l.label]));
  const reply = enforceCardOwnership(sanitizeLinks(rawReply, allowed), urlToLabel);

  // Kick off follow-up generation in parallel — it overlaps the typewriter so
  // the chips are ready by the time the reply finishes typing. Skip for intro.
  const followups = intro ? undefined : generateFollowups(history, reply, lang);

  return new Response(typeStream(reply, followups), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export function GET() {
  return json(405, { error: "Use POST." });
}
