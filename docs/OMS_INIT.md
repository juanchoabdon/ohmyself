# `oms init` — wire a folder to your second brain

**Epic D3.** One command to bind a project folder to ohmyself MCP — the hosted
equivalent of OpenKnowledge's `ok init`.

## Quick start

From any project folder:

```bash
# From the ohmyself monorepo (after pnpm install):
pnpm oms init

# With your personal token (create at www.ohmyself.ai → Settings → MCP):
OMS_TOKEN=oms_… pnpm oms init --token "$OMS_TOKEN"
```

Reload Cursor → MCP **ohmyself** should connect → run `get_structure`.

## What it creates

| Path | Committed? | Purpose |
|------|------------|---------|
| `.oms/config.yml` | ✅ yes | Project name, brain mode, MCP URL, skill hints |
| `.oms/README.md` | ✅ yes | Quick start for humans + agents |
| `.oms/mcp/claude-desktop.json` | ✅ yes | Paste into Claude Desktop config |
| `.oms/mcp/codex.toml` | ✅ yes | Fragment for `~/.codex/config.toml` |
| `.oms/secrets.env` | ❌ gitignored | `OMS_TOKEN=…` when you pass `--token` |
| `.cursor/mcp.json` | ✅ usually | Cursor project MCP (merged with `--force`) |

## Modes

### `hosted` (default)

Remote MCP at `https://www.ohmyself.ai/mcp` with a personal `oms_` token.

```bash
pnpm oms init --token "$OMS_TOKEN"
pnpm oms init --space <company-space-uuid>   # adds X-Brain-Space header
```

OAuth (Claude / ChatGPT): no local config — add connector URL `https://www.ohmyself.ai/mcp`.

### `local` (Obsidian / fs vault)

Stdio MCP against a markdown folder on disk:

```bash
pnpm oms init --mode local --vault ./brain
```

Auto-detects the ohmyself monorepo for `tsx server/src/mcp/stdio.ts`.

## CLI reference

```
oms init [options]

  --name <name>          Display name (default: folder name)
  --mode hosted|local    Brain backend (default: hosted)
  --token <oms_…>        Token or OMS_TOKEN env
  --mcp-url <url>        Override MCP URL
  --space <id>           Company space id
  --scope secret|private|public
  --vault <path>         Local vault (--mode local)
  --client cursor,claude,codex
  --cwd <path>
  --force                Overwrite existing files
```

## Skills

Canonical skills live in your brain at `skills/<slug>/SKILL.md`. After init:

1. Use MCP `list_skills` / `get_skill` to read them.
2. Sync local copies with the **sync-skills** skill (personal canon in self space).

`.oms/config.yml` lists recommended starters: `task-operation-flowya`, `ohmyself-space-routing`, `wiki-governance`.

## Monorepo development

```bash
# server/package.json exposes the bin:
pnpm --filter @ohmyself/server exec oms init --help

# Root shortcut:
pnpm oms init
```

## Related docs

- [README.md](../README.md) — full server setup
- [SECOND_SELF_SETUP.md](./SECOND_SELF_SETUP.md) — build your own second self
- [DEPLOYMENT.md](./DEPLOYMENT.md) — prod URLs + MCP contract bumps
