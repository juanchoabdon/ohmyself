# Brain conventions

Your brain is a set of plain markdown (`.md`) files. Every file has a YAML
frontmatter header followed by free-form markdown. The frontmatter is the only
"structured" part — it powers search, filtering, and privacy.

## Frontmatter schema

```yaml
---
id: prj-rappi-checkout        # stable slug-ish id (optional; auto-derived from path if omitted)
title: Checkout revamp        # required, human title
type: project                 # one of the configured note types (see below)
visibility: private           # public | private | secret  (see Privacy)
tags: [rappi, payments]       # optional list
created: 2026-06-28           # ISO date (auto-set on create)
updated: 2026-06-28           # ISO date (auto-bumped on write)
links: [people/maria.md]      # optional relative paths to related notes
---
```

Only `title` is strictly required. `type` defaults to `note` and `visibility`
defaults to the config's `defaultVisibility` (`private`).

## Note types (default taxonomy)

| type        | default folder        | what it holds                                  |
|-------------|-----------------------|------------------------------------------------|
| `identity`  | `identity/`           | who you are, values, ambitions, bio            |
| `goal`      | `goals/<year>/`       | yearly / quarterly / monthly goals             |
| `project`   | `projects/<slug>/`    | a project (`_index.md` is its home)            |
| `prd`       | `projects/<slug>/prds/` | product requirement docs                     |
| `spec`      | `projects/<slug>/specs/` | technical specs                             |
| `transcript`| `projects/<slug>/transcripts/` | meeting transcriptions               |
| `person`    | `people/`             | a person in your life                          |
| `journal`   | `journal/<year>/`     | dated journal entries                          |
| `finance`   | `finance/`            | financial notes                                |
| `note`      | `notes/`              | inbox / random notes                           |
| `todo`      | `todos/`              | cross-cutting todo lists                        |

This taxonomy is **per-user and customizable**: it lives in `user_config` and is
mirrored to `_meta/config.md`. Add/rename types or folders there; the server
validates new notes against your config, not a global fixed schema.

## Privacy

`visibility` is enforced everywhere (MCP tools, REST API):

- `public` — anyone (e.g. the public agent on your website) may read it.
- `private` — only you, authenticated.
- `secret` — only you, with an elevated scope (e.g. Rappi work, finances).

A request carries a **scope** derived from auth. A scope can read everything at
or below its level: `public ⊂ private ⊂ secret`. The public website agent runs
with scope `public` and can never read `private`/`secret` notes.

## Paths

Files live under a per-user prefix in storage. A note's "path" is everything
after that prefix, e.g. `projects/rappi/_index.md`. Use lowercase, hyphenated
slugs for folders and filenames.
