export type Lang = "es" | "en";

export interface Suggestion {
  icon: string;
  text: string;
}

export interface BrainStrings {
  title: string;
  subtitle: string;
  backToChat: string;
  listView: string;
  graphView: string;
  ideaLinks: string;
  searchPlaceholder: string;
  notesCount: (n: number) => string;
  emptyTitle: string;
  emptySub: string;
  loading: string;
  loadError: string;
  openInGraph: string;
  close: string;
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
  navChat: string;
  navBrain: string;
  brain: BrainStrings;
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
      { icon: "🎧", text: "¿Qué música, deportes o pelis le gustan?" },
      { icon: "🔮", text: "¿Qué piensa sobre el futuro?" },
    ],
    disclaimer: "Respondo solo con lo que Juan Diego ha compartido públicamente.",
    errorGeneric: "Uy, algo falló. Intenta de nuevo en un momento.",
    errorRate: "Vas muy rápido 😅 Espera unos segundos y vuelve a intentar.",
    newChat: "Nueva conversación",
    poweredBy: "Hecho con ohmyself!",
    navChat: "Chat",
    navBrain: "Second Brain",
    brain: {
      title: "Second Brain",
      subtitle: "Las notas públicas de Juan Diego, en crudo — como carpetas de Obsidian.",
      backToChat: "Volver al chat",
      listView: "Carpetas",
      graphView: "Grafo",
      ideaLinks: "Conexiones de ideas",
      searchPlaceholder: "Buscar notas…",
      notesCount: (n: number) => `${n} nota${n === 1 ? "" : "s"} pública${n === 1 ? "" : "s"}`,
      emptyTitle: "Todavía no hay notas públicas",
      emptySub: "Cuando Juan Diego marque notas como públicas, aparecerán aquí.",
      loading: "Cargando…",
      loadError: "No se pudo cargar. Intenta de nuevo.",
      openInGraph: "Ver en el grafo",
      close: "Cerrar",
    },
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
      { icon: "🎧", text: "What music, sports or movies is he into?" },
      { icon: "🔮", text: "What does he think about the future?" },
    ],
    disclaimer: "I only answer with what Juan Diego has chosen to share publicly.",
    errorGeneric: "Oops, something went wrong. Please try again in a moment.",
    errorRate: "Whoa, slow down a sec 😅 Try again shortly.",
    newChat: "New chat",
    poweredBy: "Built with ohmyself!",
    navChat: "Chat",
    navBrain: "Second Brain",
    brain: {
      title: "Second Brain",
      subtitle: "Juan Diego's public notes, raw — browse them like Obsidian folders.",
      backToChat: "Back to chat",
      listView: "Folders",
      graphView: "Graph",
      ideaLinks: "Idea links",
      searchPlaceholder: "Search notes…",
      notesCount: (n: number) => `${n} public note${n === 1 ? "" : "s"}`,
      emptyTitle: "No public notes yet",
      emptySub: "Once Juan Diego marks notes as public, they'll show up here.",
      loading: "Loading…",
      loadError: "Couldn't load that. Please try again.",
      openInGraph: "View in graph",
      close: "Close",
    },
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
