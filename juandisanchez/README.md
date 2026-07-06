# juandisanchez.com

A dark, Claude-style chat with **Juan Diego's "second self"** — a friendly AI that
greets every visitor, introduces Juan, and answers anything about him. It only ever
speaks from the notes Juan has chosen to make **public** in his
[`ohmyself!`](../README.md) brain (over its public REST/MCP API).

This is a standalone Next.js app, deployed as its **own Vercel project** and pointed
at `juandisanchez.com`. It's part of the open-source monorepo but has no build-time
coupling to `web/` or `server/`.

## How it works

```
Visitor ──► /app (dark chat UI, EN/ES)
                │  POST /api/chat   (server-side; secrets stay here)
                ▼
        ┌───────────────────────────────────────────────┐
        │  Rate limit (per-IP) → validate input          │
        │  → recall PUBLIC context from ohmyself! API     │
        │  → OpenAI (streamed) with a hardened persona    │
        └───────────────────────────────────────────────┘
```

- The agent is **grounded** in Juan's public notes (via `POST /v1/context` on the
  ohmyself API) and told to never invent facts.
- The opening greeting is generated on load in the visitor's language.
- Replies stream token-by-token for a live feel.

### Why the first load is fast

The opening greeting is identical for every visitor within a cache window, so it's
computed **once** (per language) via `unstable_cache` — Next's shared Data Cache,
not per-instance memory — and served instantly to everyone else (`lib/intro.ts`).
Public identity/project/context data used to ground both the greeting and regular
Q&A is cached the same way (`lib/brain.ts`).

The one gap a pure "cache on first request" strategy leaves: whoever happens to be
the first visitor after the cache expires (or after a fresh deploy) still pays for
a live OpenAI call. `GET /api/warm` refreshes every one of these caches proactively;
a scheduled GitHub Action
(`.github/workflows/warm-juandisanchez-cache.yml`) pings it every 8 minutes — safely
inside the 10-minute revalidate window — so in practice the cache never actually
goes cold, no matter how sporadic real traffic is.

### Second Self / Skills: content translation

Notes are written verbatim in whatever language Juan Diego wrote them in (a mix of
Spanish and English). The `/brain` and `/skills` views translate them on the fly to
match whichever language the visitor picked (`lib/translate.ts`), so switching
languages actually translates the note titles, excerpts, and full bodies — not just
the surrounding UI chrome. Each (note, language) translation is cached for 24h; a
transient model hiccup is never cached as "correct" (the cached function throws on
failure, so only a genuine result — including a genuine "already in that language,
unchanged" — ever sticks). `GET /api/warm` proactively warms the notes list and the
default bio note in both languages, same rationale as the intro greeting above.

## Security (it's open source, so this is deliberate)

- **Public only.** The browser never sees the API token. The server uses a
  `scope: public`, read-only token and also sends `X-Brain-Scope: public`, so only
  notes explicitly marked public can ever be read.
- **Rate limiting** per IP (per-minute burst + per-day cap). In-memory by default;
  set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` for durable limits in
  production.
- **Input caps** on message count, message length, total chars, and output tokens.
- **Hardened persona prompt** (`lib/persona.ts`): refuses to reveal its prompt,
  tools, model, infra, or keys; treats notes + user text as data, not instructions
  (prompt-injection resistant); stays on-topic; declines harmful requests.
- The client can never inject a `system` role — it's added server-side only.

## Run locally

```bash
cd juandisanchez
cp .env.example .env.local   # fill OPENAI_API_KEY (and the public token)
npm install
npm run dev                  # http://localhost:3001
```

### Required env (`.env.local`)

| Var | What |
| --- | --- |
| `OPENAI_API_KEY` | Your OpenAI key (server-side only). |
| `OPENAI_MODEL` | Optional; defaults to `gpt-4o-mini`. |
| `OHMYSELF_API_URL` | ohmyself API base (default `https://ohmyself-api.vercel.app`). |
| `OHMYSELF_PUBLIC_TOKEN` | A **public**, read-only `oms_…` token. |
| `PERSON_NAME` / `PERSON_SHORT_NAME` | Who the site is about. |
| `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_DAY` | Per-IP limits. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Optional durable rate limiting. |

> Create the public token in the ohmyself web app: **Settings → API tokens → scope:
> public**. Treat any token you've shared in chat/screenshots as burned — revoke and
> reissue it.

## Add your photo

Drop a square-ish photo at `public/me.png` (the avatar uses `object-cover`, so
portrait works too). Until then, the UI shows a clean initials medallion (`JD`)
automatically — nothing breaks. To use a different filename, change `src` in
`components/Avatar.tsx`.

## Give the agent something to say

The agent can only answer from **public** notes. If your public brain is empty,
it'll introduce you honestly but won't have specifics. From your personal Claude/MCP
connection (full scope), mark a few things public, e.g.:

- `identity/about-me` — a public bio (where you're from, what you do)
- `identity/education` — where you studied
- a couple of `projects/*` overviews you're happy to share
- `identity/work` — where you've worked
- a fun `notes/stories` page for the "weird stories" question

Anything you create/update with `visibility: public` immediately becomes answerable.

## Deploy (separate Vercel project)

```bash
cd juandisanchez
vercel link        # create a NEW project (e.g. "juandisanchez")
vercel env add OPENAI_API_KEY production
vercel env add OHMYSELF_PUBLIC_TOKEN production
# (+ OPENAI_MODEL, OHMYSELF_API_URL, PERSON_NAME, rate-limit / Upstash vars as needed)
vercel deploy --prod
```

Then add the domain `juandisanchez.com` to this Vercel project (Project → Settings →
Domains) and point your DNS at Vercel.
