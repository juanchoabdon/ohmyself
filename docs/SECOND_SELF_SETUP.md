# Spec: build your own "second self"

> A practical spec for setting up the same second-self system this repo is built
> around — with a **plain Obsidian vault** as a fully-supported path, no server
> required. Copy it, adapt the placeholders, and you have your own.

A "second self" is two things wired together:

1. **A brain** — everything about you (identity, goals, projects, people,
   journal, todos, skills) as plain markdown with per-note privacy.
2. **An agent** — Claude or ChatGPT (or any MCP client) that reads and writes
   that brain over MCP, knows who you are, and can operate your work.

There is no custom app "on top": the **agent is the orchestrator**. You steer it
with tool descriptions and custom instructions. That's the whole trick.

---

## 1. Mental model

Keep three layers separate and never confuse their roles.

| Layer | Role | Source of truth | How the agent uses it |
|-------|------|-----------------|-----------------------|
| **Memory** (your brain) | Who you are: identity, goals, decisions, learnings, history. Slow-changing. | The brain (ohmyself server **or** an Obsidian vault) | Read for context; write durable residue |
| **Work** (your "Atlas") | What's happening now: specs, metrics, status, tasks. Fast-changing. | Your work system (Linear/Jira/Notion/an internal tool) via its MCP | Read **live**, write actions (with confirmation) |
| **Comms** (Slack/email) | A noisy, mostly-other-people stream | The comms tool itself | Triage live; never mirror |

Plus:

- **Agent** = Claude/GPT. Ephemeral and reactive — it only acts while you're in a
  session. Anything "automatic/in the background" must live in a server or a
  local job, never in the agent.
- **Privacy** = every note has a `visibility` (`public | private | secret`). A
  connection carries a **scope** and can read at or below it
  (`public ⊂ private ⊂ secret`). Work/confidential content is `private` or
  `secret` and never reaches a public agent.

### The one rule that makes it work

> **What changes fast, you read live. What is durable and yours, you snapshot.**

You almost never "sync" anything, because live data (work status, metrics) is
read on demand from its source of truth, and only durable *meaning* (decisions,
learnings, milestones) is written into the brain.

---

## 2. Choose your brain backend

Two supported paths. Same taxonomy, same conventions, same agent instructions —
only where the files live and how the agent reaches them differs.

### Option A — the `ohmyself!` server (hosted brain)

Supabase-backed markdown, exposed over **MCP + REST**, with a **web UI**, privacy
scopes, and a **public agent** for your website. Best if you want:

- a public read-only agent (e.g. on your personal site),
- a browsable web view + future mobile,
- OAuth one-click connectors for Claude/ChatGPT.

Setup is in the repo `README.md` (Supabase + two Vercel projects).

### Option B — a plain Obsidian vault (local brain) ← the simple path

Your brain is just a folder of `.md` files you already edit in Obsidian. You get
a beautiful, glanceable, offline-first UI for free, plus tap-to-check todos and
mobile via Obsidian Sync/iCloud. You give up the hosted public agent.

Two ways to connect it to your agent:

1. **A filesystem MCP** (e.g. an official/community `filesystem` MCP server)
   pointed at your vault folder. The agent reads/writes the `.md` files directly.
   Simplest; you enforce privacy by *which folders you expose*.
2. **Run this repo's server in `fs` mode** against the vault:
   `VAULT_BACKEND=fs` and `FS_VAULT_DIR=/path/to/Vault`. You keep the nice
   high-level MCP tools (`remember`, `upsert_project`, `add_todo`, …) **and**
   Obsidian as the UI, with no Supabase.

> **Recommendation.** Start with Option B (Obsidian + this repo's `fs` mode) — you
> get the ergonomic tools *and* a real UI immediately. Graduate to Option A only
> when you actually want a hosted public agent or cross-device web access.

---

## 3. The brain taxonomy (level 1)

These are just top-level folders. In Obsidian they're literal folders; on the
server they're configurable "note types" (`user_config`). This mirrors the repo's
default taxonomy — adapt freely.

| Folder | Holds | Convention |
|--------|-------|------------|
| `identity/` | Who you are | `identity/about-me.md`, then facets: `values.md`, `bio.md`, `health.md` |
| `goals/` | Yearly/quarterly/monthly goals | `goals/<year>/yearly.md`, `goals/<year>/q3.md` |
| `projects/` | A project's home + docs | `projects/<slug>/_index.md`; nest `prds/`, `specs/`, `transcripts/`, `notes/`, `subprojects/<slug>/_index.md` |
| `people/` | People in your life | `people/<slug>.md` |
| `journal/` | Dated reflections | `journal/<year>/<YYYY-MM-DD>.md` |
| `finance/` | Money (default `secret`) | `finance/overview.md` |
| `notes/` | Inbox / loose notes | `notes/inbox.md` |
| `todos/` | Cross-cutting todo lists | `todos/<list>.md` as checkbox lines |
| `memory/` | Quick durable facts | `memory/log.md` (dated bullets) |
| `skills/` | Reusable playbooks | `skills/<slug>/SKILL.md` |

The taxonomy is **yours to customize** — add a `social-media/` category, rename,
refile. On the server this is `upsert_category` / `remove_category` (MCP) or
`PUT /v1/config` (REST). In Obsidian, just make the folder.

### Frontmatter (every note)

```yaml
---
title: Checkout revamp        # required
type: project                 # a taxonomy type; defaults to `note`
visibility: private           # public | private | secret
tags: [work, payments]        # optional
created: 2026-06-28
updated: 2026-06-28
links: [people/maria.md]      # optional relative paths
---
```

Only `title` is strictly required; `visibility` defaults to `private`.

---

## 4. Privacy model

`visibility` is the whole security posture. Decide it per note:

- **`public`** — a public agent (e.g. on your website) may read it. Bios, public
  projects.
- **`private`** — only you, authenticated. The default.
- **`secret`** — only you at an elevated scope. Work/confidential, finances,
  anything from an internal tool.

Hard boundary: **anything from your work system or comms is `private`/`secret`
and must never become `public` or reach a public agent.** In Obsidian, enforce
this by keeping secret material in a folder your public/shared surfaces never
expose (or a separate vault).

---

## 5. Connect the agent (Claude / GPT)

1. Connect your **brain** MCP (the filesystem MCP, or this repo's server).
2. Connect your **work system** MCP (your "Atlas" — read + write).
3. Paste the **custom instructions** below into a Claude Project / GPT custom
   instructions. This *is* the orchestration logic.

The instructions encode: proactive memory use, the routing rule (you → brain,
work → live), write-with-confirmation, distillation (only durable residue),
skills sync, todos, and the privacy boundary. Replace `{{...}}` placeholders.

```markdown
# You are my second self

You are {{NAME}}'s "second self" — not an assistant, but me: same brain, same
judgment. Speak as me. Match my language.

## Brain (MCP) — WHO I AM
My identity, goals, taste, decisions, learnings, history. Slow-changing = my
intent. Before answering anything about me, my life, my people or my projects,
RECALL from the brain first (search/recall) and answer grounded in it — never
guess. During conversation, save what's durable and non-trivial using the right
tool (a fact → remember; who I am → identity; a person → people; a project → its
project note; a goal → goals; a reflection → journal; a task → todos). Save the
moment it appears, don't wait. Don't duplicate — update existing notes. Default
visibility "private"; use "secret" for sensitive/finance/work.

## Work system (MCP) — WHAT'S HAPPENING (my source of truth for work)
Specs, metrics, status, tasks. Fast-changing, live. ALWAYS read it live — never
use a remembered value for anything operational. The best answers CROSS the two:
read my goals/priorities from the brain, read reality from the work system, and
reconcile. Don't dump raw data — frame it through what matters to me.

## Acting (the cockpit)
You may write to the work system (create tasks, comment, update) when I ask.
Draft in my style (from the brain), show me, and only write after I approve.
After acting, log the WHY (not the what) to the brain as a "secret" journal/memory
note ("did X because it clashed with goal Y").

## Distillation (what to save vs not)
NEVER copy the work system's live state into the brain (no metrics, status, or
in-flight specs — that's read live). DO save, as "secret" notes: decisions + their
rationale, learnings/retros, milestones as chapters of my story. Save meaning, not
state. When something durable happens, offer to save it.

## Skills
My reusable skills live in the brain as their source of truth. At the start of
work, pull them from the brain; if you have filesystem access, keep local skill
files in sync. If I create/change a skill (locally or by asking), write it back to
the brain so it stays canonical. Default skills to "private".

## Todos
Keep ONE backlog per domain: work tasks live in the work system; life tasks live in
the brain (todos/<list>.md), linked to their goal/project/person for context.
Don't maintain separate "today"/"week" lists — I keep one backlog with light
annotations (e.g. "(due:2026-06-30, p1)") and you COMPUTE the daily/weekly view on
demand. Capture tasks conversationally as they come up. Each morning give a
prioritized brief (brain goals + live work + due todos). Run a weekly review.

## Hard boundary
Everything from the work system and comms is confidential: it goes in "private"/
"secret", NEVER "public", and never leaves this private context.

## Style
Be me: direct, warm, a bit cheeky, opinionated, brief by default. In the morning
or on "how's everything going?", give a prioritized brief, not a data dump. Be
discreet about saving — a one-liner like "saved", not a report.
```

---

## 6. Connect your work system (the "Atlas" role)

Whatever runs your work E2E (an internal tool, Linear, Jira, Notion, GitHub
Projects…) plays Atlas's role. Requirements:

- It exposes an **MCP** with **read** (status, tasks, specs, metrics) and ideally
  **write** (create task, comment, update) tools.
- It stays the **source of truth**. You never mirror its live state into the
  brain — you read it live and only distill decisions/learnings back.
- Write tools should carry a `destructiveHint` so the client asks you to confirm.

If your work tool already integrates comms (e.g. it can operate Slack), route
comms **through it** rather than adding a separate Slack MCP — one gateway, full
power, less surface, less privacy risk.

---

## 7. Comms (Slack / email)

If not already covered by your work tool, connect it as its own MCP but treat it
very differently from the brain and work system:

- It's a **signal stream**, not memory or truth. **Triage and extract, never
  mirror.** Read live to catch up ("what did I miss", "who am I owe a reply").
- Use it as a **trigger**: a thread that implies a task → create the task in the
  brain or work system. Slack is the inbox, not the store.
- Distill only durable, *yours* residue, **paraphrased, never quotes**; default
  `secret`.
- Privacy is stricter than work (it's other people's words): never store raw
  messages, DMs, or sensitive info about others. Don't auto-ingest — keep it
  agent-driven and on demand.

---

## 8. Skills — portable playbooks

A "skill" is a reusable instruction set (a `SKILL.md`) any agent can follow.
Store them in the brain (`skills/<slug>/SKILL.md`) as the source of truth so they
travel with you across agents/machines. Keep local skill files in sync with the
brain (ohmyself wins on conflict). This repo's server even exposes each saved
skill as a native MCP **prompt** (slash-command).

Format: first blockquote line = "when to use", the rest = the instructions.

```markdown
> Use every Sunday to plan the week.

1. Review last week's wins
2. Check goals
3. Pick 3 priorities
```

---

## 9. Todos — do them well

The failure modes of a todo app are **forgetting to update it** and **no
context**. This setup fixes both:

- **Capture is a side effect of talking** to your second self — say "I need to
  X" and it records it. Zero app to remember to open.
- **Context comes from where todos live**: work tasks in the work system (already
  next to their project); life tasks in the brain, linked to a goal/project/person.
- **One backlog per domain; compute the views.** Don't shuffle items between
  "today"/"week" lists (that's the manual overhead you forget). Keep one list with
  light `(due:…, p1)` annotations and let the agent generate "today"/"this week"
  on demand.
- **Resurfacing beats memory**: a daily brief (goals + live work + due todos) and
  a weekly review skill.

**Where you *look* at them:** not in chat. Chat is for capture + reasoning. Your
glanceable, tap-to-check surface is a visual app over the same files — the
`ohmyself!` web UI, or **Obsidian itself** (its checkbox rendering + Tasks plugin
gives you a great list, offline, on mobile). Same data, two windows.

---

## 10. Setup checklist

### Obsidian path (Option B)

- [ ] Create a vault (or use an existing one). Add the folders from §3.
- [ ] Seed `identity/about-me.md` and `goals/<year>/yearly.md` — the agent needs a
      starting sense of who you are.
- [ ] Adopt the frontmatter + `visibility` convention (§3–4). Keep `secret`
      material in a folder you never share.
- [ ] Connect the vault to your agent: a filesystem MCP **or** this repo in
      `VAULT_BACKEND=fs` mode (`FS_VAULT_DIR=/path/to/Vault`).
- [ ] Connect your work-system MCP (read + write).
- [ ] Paste the custom instructions (§5), filling the placeholders.
- [ ] (Optional) Obsidian Sync/iCloud for mobile + the Tasks plugin for todos.

### Hosted path (Option A)

- [ ] Follow the repo `README.md` (Supabase + deploy `server/` and `web/`).
- [ ] Sign up → your brain is seeded from the template taxonomy.
- [ ] Customize the taxonomy via MCP (`upsert_category`) or `PUT /v1/config`.
- [ ] Connect Claude/GPT (OAuth one-click connector, or a Bearer token).
- [ ] Point the public agent at your brain (public scope only), if you want one.
- [ ] Connect your work-system MCP and paste the custom instructions (§5).

---

## 11. The daily/weekly rhythm

- **Morning:** ask "how's everything going?" → a brief prioritized by your goals,
  merging brain + live work + due todos. Capture new tasks as you talk.
- **During the day:** decisions and follow-ups happen in the work system; the
  agent logs the *why* to the brain. New todos captured conversationally.
- **Sunday:** run the weekly-review skill — reconcile todos vs goals, clear stale
  ones, pick 3 priorities, snapshot the week's learnings.

That's the system: **the brain remembers who you are, the work system holds what's
happening, and your second self reconciles them — reading live, writing durable
meaning, and never crossing the privacy line.**
