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

export function agentCollabUser(agentId: string, label?: string): CollabUser {
  const id = agentId.startsWith("agent:") ? agentId : `agent:${agentId}`;
  const short = id.replace(/^agent:/, "");
  return {
    id,
    name: label?.trim() || short || "Agent",
    color: colorFromId(id),
    kind: "agent",
  };
}
