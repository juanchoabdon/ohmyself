import type { User } from "@supabase/supabase-js";

/** Palette tuned for dark/light surfaces — matches OK-style presence colors. */
const PRESENCE_COLORS = [
  "#f78361",
  "#7c6cff",
  "#3db88a",
  "#e8a838",
  "#e0527a",
  "#4a9fd4",
  "#c77dff",
  "#56c8b8",
] as const;

export type CollabUser = {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  kind: "human" | "agent";
};

export function colorFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

export function collabUserFromSupabase(user: User): CollabUser {
  const meta = user.user_metadata ?? {};
  const name =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    user.email?.split("@")[0] ||
    "You";
  const avatarUrl =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    null;
  return {
    id: user.id,
    name,
    color: colorFromId(user.id),
    avatarUrl,
    kind: "human",
  };
}

/** Well-known agent identifiers → display names. Keys are lowercase. */
const AGENT_NAMES: Record<string, string> = {
  // legacy auth-method authors (before writes carried the client name)
  token: "Agent",
  oauth: "Agent",
  public: "Agent",
  ohmyself: "ohmyself",
  // MCP clientInfo names
  cursor: "Cursor",
  "cursor-vscode": "Cursor",
  "claude-ai": "Claude",
  "claude-code": "Claude Code",
  "claude-desktop": "Claude",
  chatgpt: "ChatGPT",
  "openai-mcp": "ChatGPT",
};

/** "agent:cursor-vscode" → "Cursor"; unknown ids get a title-cased cleanup. */
export function prettyAgentName(agentId: string): string {
  const short = agentId.replace(/^agent:/, "").trim();
  if (!short) return "Agent";
  const known = AGENT_NAMES[short.toLowerCase()];
  if (known) return known;
  if (/^[a-z0-9._-]+$/.test(short)) {
    return short
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return short;
}

export function agentCollabUser(agentId: string, label?: string): CollabUser {
  const id = agentId.startsWith("agent:") ? agentId : `agent:${agentId}`;
  return {
    id,
    name: label?.trim() || prettyAgentName(id),
    color: colorFromId(id),
    kind: "agent",
  };
}
