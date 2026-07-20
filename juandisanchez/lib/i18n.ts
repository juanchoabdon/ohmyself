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
  projectsLabel: string;
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

export interface SkillsStrings {
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  skillsCount: (n: number) => string;
  emptyTitle: string;
  emptySub: string;
  loading: string;
  loadError: string;
  whenToUse: string;
  viewFull: string;
  close: string;
}

export interface Strings {
  tagline: string;
  placeholder: string;
  send: string;
  thinking: string;
  /** Instant, in-voice micro-status shown the moment a question is sent,
   *  picked by topic — so the site "reacts" at 0ms even while the model
   *  is still working. */
  statusProjects: string;
  statusWork: string;
  statusPersonal: string;
  statusDefault: string;
  suggestionsLabel: string;
  suggestions: Suggestion[];
  disclaimer: string;
  errorGeneric: string;
  errorRate: string;
  newChat: string;
  poweredBy: string;
  navChat: string;
  navBrain: string;
  navSkills: string;
  brain: BrainStrings;
  skills: SkillsStrings;
}

const STRINGS: Record<Lang, Strings> = {
  es: {
    tagline: "second self · siempre online",
    placeholder: "Pregúntame lo que quieras…",
    send: "Enviar",
    thinking: "Pensando…",
    statusProjects: "dame un sec, repaso mis proyectos…",
    statusWork: "un momento, pienso cómo contarte lo del trabajo…",
    statusPersonal: "jaja buena — dame un sec…",
    statusDefault: "dame un sec, reviso mis notas…",
    suggestionsLabel: "Prueba con:",
    suggestions: [
      { icon: "🚀", text: "¿Qué estás construyendo?" },
      { icon: "🍔", text: "¿Qué haces en Rappi?" },
      { icon: "🎧", text: "¿Qué te gusta fuera del trabajo?" },
      { icon: "🔮", text: "¿Cómo ves el futuro?" },
    ],
    disclaimer: "Solo cuento lo que he compartido públicamente.",
    errorGeneric: "Uy, algo falló. Intenta de nuevo en un momento.",
    errorRate: "Vas muy rápido 😅 Espera unos segundos y vuelve a intentar.",
    newChat: "Nueva conversación",
    poweredBy: "Hecho con ohmyself!",
    navChat: "Chat",
    navBrain: "Second Self",
    navSkills: "Skills",
    brain: {
      title: "Second Self",
      subtitle: "Las notas públicas de Juan Diego, en crudo — organizadas en carpetas.",
      backToChat: "Volver al chat",
      listView: "Carpetas",
      graphView: "Grafo",
      projectsLabel: "Proyectos",
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
    skills: {
      title: "Skills",
      subtitle: "Los playbooks que Juan Diego usa día a día — cómo trabaja, no solo qué construye.",
      searchPlaceholder: "Buscar skills…",
      skillsCount: (n: number) => `${n} skill${n === 1 ? "" : "s"} público${n === 1 ? "" : "s"}`,
      emptyTitle: "Todavía no hay skills públicos",
      emptySub: "Cuando Juan Diego marque un skill como público, aparecerá aquí.",
      loading: "Cargando…",
      loadError: "No se pudo cargar. Intenta de nuevo.",
      whenToUse: "Cuándo usarlo",
      viewFull: "Ver skill completo",
      close: "Cerrar",
    },
  },
  en: {
    tagline: "second self · always online",
    placeholder: "Ask me anything…",
    send: "Send",
    thinking: "Thinking…",
    statusProjects: "one sec, going through my projects…",
    statusWork: "one sec, thinking how to tell you about work…",
    statusPersonal: "ha, good one — give me a sec…",
    statusDefault: "one sec, checking my notes…",
    suggestionsLabel: "Try asking:",
    suggestions: [
      { icon: "🚀", text: "What are you building?" },
      { icon: "🍔", text: "What do you do at Rappi?" },
      { icon: "🎧", text: "What are you into outside work?" },
      { icon: "🔮", text: "How do you see the future?" },
    ],
    disclaimer: "I only talk about what I've shared publicly.",
    errorGeneric: "Oops, something went wrong. Please try again in a moment.",
    errorRate: "Whoa, slow down a sec 😅 Try again shortly.",
    newChat: "New chat",
    poweredBy: "Built with ohmyself!",
    navChat: "Chat",
    navBrain: "Second Self",
    navSkills: "Skills",
    brain: {
      title: "Second Self",
      subtitle: "Juan Diego's public notes, raw — browse them like folders.",
      backToChat: "Back to chat",
      listView: "Folders",
      graphView: "Graph",
      projectsLabel: "Projects",
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
    skills: {
      title: "Skills",
      subtitle: "The playbooks Juan Diego actually runs on — how he works, not just what he ships.",
      searchPlaceholder: "Search skills…",
      skillsCount: (n: number) => `${n} public skill${n === 1 ? "" : "s"}`,
      emptyTitle: "No public skills yet",
      emptySub: "Once Juan Diego marks a skill as public, it'll show up here.",
      loading: "Loading…",
      loadError: "Couldn't load that. Please try again.",
      whenToUse: "When to use it",
      viewFull: "View full skill",
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
