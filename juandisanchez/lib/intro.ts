/** The opening greeting, computed ONCE per language across ALL visitors for
 *  the revalidate window (Next's Data Cache, shared across every serverless
 *  instance/region) — this is what removes the "every new visitor waits on
 *  an OpenAI call" latency entirely for the common case.
 *
 *  Extracted into its own module (rather than living in the chat route) so
 *  it can also be called from `/api/warm` — a lightweight endpoint that lets
 *  us proactively refresh this cache on a schedule, instead of waiting for
 *  whichever unlucky visitor happens to arrive right after it expires. */
import { unstable_cache } from "next/cache";
import { introContext, type LinkRef } from "@/lib/brain";
import { PERSON_SHORT_NAME, buildSystemPrompt, introInstruction } from "@/lib/persona";
import { complete } from "@/lib/openai";

export const INTRO_REVALIDATE_S = 600;

export interface IntroPayload {
  reply: string;
  links: LinkRef[];
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  out = out.replace(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g, (m, url) => (ok(url) ? m : ""));
  out = out.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, text, url) =>
    ok(url) ? m : text,
  );
  out = out.replace(/https?:\/\/[^\s)\]}"'<>]+/g, (url) => (ok(url) ? url : ""));
  return out;
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

export const getCachedIntro = unstable_cache(
  async (lang: "es" | "en"): Promise<IntroPayload> => {
    const ground = await introContext(PERSON_SHORT_NAME);
    const messages = [
      { role: "system" as const, content: buildSystemPrompt(ground.text, ground.links) },
      { role: "user" as const, content: introInstruction(lang) },
    ];
    const rawReply = await complete(messages);
    const fallback =
      lang === "es"
        ? `¡Hey! Soy ${PERSON_SHORT_NAME} — bueno, mi second self, la versión de mí que siempre está online. Pregúntame lo que quieras.`
        : `Hey! I'm ${PERSON_SHORT_NAME} — well, my second self, the always-online me. Ask me anything.`;
    const reply = rawReply ?? fallback;
    const allowed = new Set(ground.links.map((l) => l.url.replace(/\/$/, "")));
    const urlToLabel = new Map(ground.links.map((l) => [l.url.replace(/\/$/, ""), l.label]));
    const clean = enforceCardOwnership(sanitizeLinks(reply, allowed), urlToLabel);
    return { reply: clean, links: ground.links };
  },
  // v4: the greeting now explains what Rappi is (most visitors outside
  // Latam don't know it). Bumping the key drops the previously cached
  // greeting immediately instead of waiting out its revalidate window.
  ["intro-reply-v4"],
  { revalidate: INTRO_REVALIDATE_S },
);
