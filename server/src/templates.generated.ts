// AUTO-GENERATED from templates/brain. Run scripts to regenerate.
// Embeds the default brain so onboarding/seed works without filesystem access (serverless-safe).

export interface TemplateNote { path: string; raw: string }

export const TEMPLATE_BRAIN: TemplateNote[] = [
  {
    path: "finance/overview.md",
    raw: "---\nid: finance-overview\ntitle: Finance overview\ntype: finance\nvisibility: secret\ntags: [finance, confidential]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [goals/2026/yearly.md]\n---\n\n# Finance overview\n\n`secret` by default. High-level financial picture, accounts, and targets go here\nso the personal agent can help with planning — but never the public agent.\n\n- (placeholder) Runway, income streams, savings targets.\n",
  },
  {
    path: "goals/2026/q3.md",
    raw: "---\nid: goals-2026-q3\ntitle: 2026 Q3 Goals\ntype: goal\nvisibility: private\ntags: [goals, 2026, q3]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [goals/2026/yearly.md, projects/ohmyself/_index.md]\n---\n\n# 2026 Q3\n\n- `ohmyself!` v1: MCP tools + REST API + web viewer + chat.\n- Connect personal Claude over MCP and use it daily for planning.\n- Public agent prototype on juandisanchez.com.\n",
  },
  {
    path: "goals/2026/yearly.md",
    raw: "---\nid: goals-2026\ntitle: 2026 Goals\ntype: goal\nvisibility: private\ntags: [goals, 2026]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [goals/2026/q3.md, identity/ambitions.md]\n---\n\n# 2026 Goals\n\n- Ship `ohmyself!` to a usable v1 (brain + MCP + web).\n- Ship one more Java Ventures product to first revenue.\n- Health: train 4x/week, consistent sleep.\n\nBroken down by quarter in the `goals/2026/` folder.\n",
  },
  {
    path: "identity/about-me.md",
    raw: "---\nid: about-me\ntitle: About Juan Diego Sánchez\ntype: identity\nvisibility: public\ntags: [bio, identity]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [identity/ambitions.md, projects/ohmyself/_index.md]\n---\n\n# Juan Diego Sánchez\n\nBuilder and product-minded engineer. I work across product, design, and\nengineering, and I like systems that compound: small inputs that keep paying off.\n\n- **What I do:** product + engineering, currently building ventures under Java Ventures.\n- **How I think:** bias to action, strong opinions loosely held, obsessed with leverage.\n- **Public links:** [juandisanchez.com](https://juandisanchez.com)\n\nThis note is `public` — it's the kind of thing the website agent can share freely.\n",
  },
  {
    path: "identity/ambitions.md",
    raw: "---\nid: ambitions\ntitle: Ambitions\ntype: identity\nvisibility: private\ntags: [ambition, north-star]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [goals/2026/yearly.md]\n---\n\n# Ambitions\n\nThe long-horizon stuff that drives the yearly goals.\n\n- Build a portfolio of products that are genuinely useful and durable.\n- Get to real financial independence so choices are driven by interest, not need.\n- Become the kind of operator people want to build with.\n\nPrivate: this is for me (and my personal agent), not the public.\n",
  },
  {
    path: "journal/2026/2026-06-28.md",
    raw: "---\nid: journal-2026-06-28\ntitle: \"2026-06-28\"\ntype: journal\nvisibility: private\ntags: [journal]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [projects/ohmyself/_index.md]\n---\n\n# 2026-06-28\n\nKicked off ohmyself!. Decided on markdown-as-source-of-truth + Supabase for\nauth/index, MCP + REST on top, web UI with the impeccable design skill. Feeling\ngood about the architecture — it scales to other users without becoming a\ntypical DB.\n",
  },
  {
    path: "notes/inbox.md",
    raw: "---\nid: note-inbox\ntitle: Inbox\ntype: note\nvisibility: private\ntags: [inbox]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: []\n---\n\n# Inbox\n\nQuick capture. Random thoughts land here, then get filed into the right place.\n\n- [ ] Try connecting personal Claude over MCP.\n- [ ] Write a real PRD for the next venture.\n",
  },
  {
    path: "people/example-mentor.md",
    raw: "---\nid: person-mentor\ntitle: A. Mentor\ntype: person\nvisibility: private\ntags: [mentor, relationship]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [identity/ambitions.md]\n---\n\n# A. Mentor\n\n- **Who:** a mentor I check in with on big decisions.\n- **How we met:** (fill in)\n- **What I value:** blunt, long-term thinking.\n- **Last interaction:** 2026-06-20 — talked through the ohmyself! plan.\n\nPeople notes help the agent reason about my relationships and interactions.\n",
  },
  {
    path: "projects/ohmyself/_index.md",
    raw: "---\nid: prj-ohmyself\ntitle: ohmyself!\ntype: project\nvisibility: public\ntags: [project, second-brain, mcp]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [projects/ohmyself/prds/v1.md, goals/2026/q3.md]\n---\n\n# ohmyself!\n\nA second brain as loose markdown, exposed over MCP + REST, multi-tenant and\nprivacy-aware. The endgame: a public agent on my site that can answer about me\n(within privacy), and a personal agent that knows everything and helps me decide.\n\n- **Status:** building v1.\n- **Stack:** TypeScript (core + MCP + Hono API), Next.js web, Supabase.\n- See the PRD: [v1](projects/ohmyself/prds/v1.md).\n",
  },
  {
    path: "projects/ohmyself/prds/v1.md",
    raw: "---\nid: prd-ohmyself-v1\ntitle: ohmyself! v1 PRD\ntype: prd\nvisibility: public\ntags: [prd, ohmyself]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [projects/ohmyself/_index.md]\n---\n\n# ohmyself! v1 — PRD\n\n## Problem\nEverything about a person is scattered. I want one place that holds it all as\nmarkdown, that an agent can read and write, with privacy levels.\n\n## Goals\n- Store the brain as `.md` files (not a typical DB).\n- Expose it over MCP (personal Claude) and REST (web/iOS).\n- Per-note privacy: public / private / secret.\n- Multi-tenant from day one.\n\n## Non-goals (v1)\n- Semantic/vector search (phase 2).\n- Mobile app (later; REST is ready for it).\n\n## Success\n- I use my personal Claude over MCP daily.\n- A public agent can answer about me using only public notes.\n",
  },
  {
    path: "projects/rappi/_index.md",
    raw: "---\nid: prj-rappi\ntitle: Rappi (work)\ntype: project\nvisibility: secret\ntags: [rappi, work, confidential]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: []\n---\n\n# Rappi\n\nWork project. Marked `secret` — only readable with elevated scope. The public\nagent and even my normal `private` scope won't surface this unless I explicitly\nask with secret access.\n\n- Confidential roadmap, internal docs, and meeting transcripts live under this\n  project folder.\n",
  },
  {
    path: "todos/life.md",
    raw: "---\nid: todo-life\ntitle: Life todos\ntype: todo\nvisibility: private\ntags: [todo, life]\ncreated: 2026-06-28\nupdated: 2026-06-28\nlinks: [goals/2026/q3.md]\n---\n\n# Life todos\n\nCross-cutting things that aren't tied to one project.\n\n- [ ] Set up weekly review ritual.\n- [ ] Book the trip.\n- [x] Decide ohmyself! architecture.\n",
  },
];
