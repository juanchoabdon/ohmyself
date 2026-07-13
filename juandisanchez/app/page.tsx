import { Chat, type EmbeddedIntro } from "@/components/Chat";
import { getCachedIntro } from "@/lib/intro";
import { PERSON_SHORT_NAME } from "@/lib/persona";
import type { Lang } from "@/lib/i18n";

/** Statically regenerate the page (with fresh intros baked in) every 10
 *  minutes — same cadence as the intro cache itself. Visitors always get a
 *  CDN-served HTML page that already CONTAINS the greeting, so the first
 *  message starts typing instantly with zero API round-trips. */
export const revalidate = 600;

function fallbackIntro(lang: Lang): EmbeddedIntro {
  return {
    reply:
      lang === "es"
        ? `¡Hola! Soy el second self de ${PERSON_SHORT_NAME}. Pregúntame lo que quieras sobre él.`
        : `Hey! I'm ${PERSON_SHORT_NAME}'s second self. Ask me anything about him.`,
    links: [],
  };
}

async function safeIntro(lang: Lang): Promise<EmbeddedIntro> {
  try {
    const { reply, links } = await getCachedIntro(lang);
    return { reply, links: links.map((l) => ({ url: l.url, label: l.label })) };
  } catch {
    return fallbackIntro(lang);
  }
}

export default async function Page() {
  const [en, es] = await Promise.all([safeIntro("en"), safeIntro("es")]);
  return <Chat intro={{ en, es }} />;
}
