export type Lang = "es" | "en";

export interface Suggestion {
  icon: string;
  text: string;
}

export interface Strings {
  tagline: string;
  placeholder: string;
  send: string;
  thinking: string;
  suggestionsLabel: string;
  suggestions: Suggestion[];
  disclaimer: string;
  errorGeneric: string;
  errorRate: string;
  newChat: string;
  poweredBy: string;
}

const STRINGS: Record<Lang, Strings> = {
  es: {
    tagline: "second self · pregúntame lo que sea",
    placeholder: "Pregúntale a mi second self…",
    send: "Enviar",
    thinking: "Pensando…",
    suggestionsLabel: "Prueba con:",
    suggestions: [
      { icon: "🚀", text: "¿Qué proyectos ha construido?" },
      { icon: "🍔", text: "¿Qué ha hecho dentro de Rappi?" },
      { icon: "🔮", text: "¿Qué piensa sobre el futuro?" },
      { icon: "🎲", text: "Cuéntame una historia random" },
    ],
    disclaimer: "Respondo solo con lo que Juan Diego ha compartido públicamente.",
    errorGeneric: "Uy, algo falló. Intenta de nuevo en un momento.",
    errorRate: "Vas muy rápido 😅 Espera unos segundos y vuelve a intentar.",
    newChat: "Nueva conversación",
    poweredBy: "Hecho con ohmyself!",
  },
  en: {
    tagline: "second self · ask me anything",
    placeholder: "Ask my second self…",
    send: "Send",
    thinking: "Thinking…",
    suggestionsLabel: "Try asking:",
    suggestions: [
      { icon: "🚀", text: "What has he built?" },
      { icon: "🍔", text: "What does he do at Rappi?" },
      { icon: "🔮", text: "What does he think about the future?" },
      { icon: "🎲", text: "Tell me a random story" },
    ],
    disclaimer: "I only answer with what Juan Diego has chosen to share publicly.",
    errorGeneric: "Oops, something went wrong. Please try again in a moment.",
    errorRate: "Whoa, slow down a sec 😅 Try again shortly.",
    newChat: "New chat",
    poweredBy: "Built with ohmyself!",
  },
};

export function strings(lang: Lang): Strings {
  return STRINGS[lang];
}

/** Detect the visitor's preferred language from the browser. */
export function detectLang(): Lang {
  if (typeof navigator === "undefined") return "en";
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of langs) {
    if (l?.toLowerCase().startsWith("es")) return "es";
    if (l?.toLowerCase().startsWith("en")) return "en";
  }
  return "en";
}
