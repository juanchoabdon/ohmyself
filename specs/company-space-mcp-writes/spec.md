# Company-space MCP writes

## Problem

The personal ohmyself MCP can discover and read company spaces by slug, but it cannot write to them. OAuth clients such as Codex therefore see Bonds Company yet can only persist notes and skills into JD's self space. This creates silent routing errors and leaves the company wiki empty.

## Outcome

An authenticated company owner/admin can create, update, append, link, and save skills in a company space through explicit MCP tools using the stable space slug returned by `list_spaces`.

## Tools

- `create_space_note`
- `update_space_note`
- `append_space_note`
- `link_space_notes`
- `save_space_skill`

All accept `space` from `list_spaces`. Reads remain available to members. Company writes require a non-read-only connection and role `owner` or `admin`; plain members receive a forbidden error. Visibility remains capped by the caller's MCP scope and company role.

## Acceptance criteria

1. The tools are present in the MCP tool catalog.
2. An owner/admin can write to the selected company space without changing the active self-space tenant.
3. A plain member cannot write.
4. Writes never fall back to the personal space.
5. `save_space_skill` stores `skills/<slug>/SKILL.md` inside the company space.
6. Existing personal and company read tools remain backward compatible.
