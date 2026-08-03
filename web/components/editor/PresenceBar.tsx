"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { Bot } from "lucide-react";
import type { CollabUser } from "@/lib/collabUser";
import { cn } from "@/lib/utils";

export type PresencePeer = {
  clientId: number;
  id?: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  kind?: "human" | "agent";
  isLocal?: boolean;
  /** True when the peer is live on the Yjs socket (drives the green dot). */
  live?: boolean;
};

export type CollabSyncStatus = "connecting" | "synced" | "offline";

/** Snapshot the room's awareness states as presence peers. */
export function readPeers(provider: HocuspocusProvider, localUser: CollabUser): PresencePeer[] {
  const awareness = provider.awareness;
  if (!awareness) return [];
  const localId = awareness.clientID;
  const peers: PresencePeer[] = [];
  awareness.getStates().forEach((state, clientId) => {
    const user = (state?.user ?? {}) as Partial<PresencePeer>;
    const name = user.name?.trim() || "Someone";
    peers.push({
      clientId,
      id: user.id,
      name,
      color: user.color || "#7c6cff",
      avatarUrl: user.avatarUrl,
      kind: user.kind ?? "human",
      isLocal: clientId === localId,
      live: true,
    });
  });
  if (!peers.some((p) => p.isLocal)) {
    peers.unshift({
      clientId: localId,
      id: localUser.id,
      name: localUser.name,
      color: localUser.color,
      avatarUrl: localUser.avatarUrl,
      kind: localUser.kind,
      isLocal: true,
      live: true,
    });
  }
  return peers.sort((a, b) => Number(b.isLocal) - Number(a.isLocal));
}

const MAX_AVATARS = 5;

/**
 * Google Docs-style header avatars: remote collaborators (humans + agents)
 * shown as an overlapping stack with a green "active" dot for peers live on
 * the socket. The local user is omitted — you know you're here.
 */
export function PresenceAvatars({
  peers,
  extraPeers = [],
  onSelectPeer,
  className,
}: {
  peers: PresencePeer[];
  /** Agents / recent editors not on the Yjs socket (no green dot). */
  extraPeers?: PresencePeer[];
  onSelectPeer?: (peer: PresencePeer) => void;
  className?: string;
}) {
  const seen = new Set<string>();
  const merged: PresencePeer[] = [];
  for (const p of [...peers, ...extraPeers]) {
    if (p.isLocal) continue;
    const key = p.id ?? `${p.kind}:${p.name}:${p.clientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  if (!merged.length) return null;

  const shown = merged.slice(0, MAX_AVATARS);
  const overflow = merged.length - shown.length;

  return (
    <div className={cn("flex items-center", className)}>
      <div className="flex -space-x-1.5">
        {shown.map((peer) => {
          const clickable = Boolean(onSelectPeer && peer.kind === "agent");
          const statusLabel =
            peer.kind === "agent"
              ? peer.live
                ? "Agent · editing now"
                : "Agent · edited recently"
              : peer.live
                ? "Editing now"
                : "Was here recently";
          return (
            <button
              key={`${peer.clientId}-${peer.id ?? peer.name}`}
              type="button"
              aria-label={`${peer.name} — ${statusLabel}`}
              onClick={() => {
                if (clickable) onSelectPeer?.(peer);
              }}
              className={cn(
                "group relative grid h-6 w-6 place-items-center rounded-full border-2 border-surface text-[9px] font-semibold text-white shadow-sm transition-transform hover:z-20 hover:scale-110",
                clickable ? "cursor-pointer" : "cursor-default",
              )}
              style={{ backgroundColor: peer.color }}
            >
              {peer.kind === "agent" ? (
                <Bot className="h-3 w-3" aria-hidden />
              ) : peer.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={peer.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span aria-hidden>{peer.name.slice(0, 1).toUpperCase()}</span>
              )}
              {peer.live && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface bg-emerald-500" />
              )}
              {/* Hover card — who this is, styled (native title tooltips are too slow). */}
              <span className="pointer-events-none absolute right-0 top-full z-30 mt-2 flex origin-top-right scale-95 flex-col items-start whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left opacity-0 shadow-lg transition-all duration-100 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: peer.color }}
                    aria-hidden
                  />
                  {peer.name}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-muted">
                  {peer.live && (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  )}
                  {statusLabel}
                </span>
                {clickable && (
                  <span className="mt-0.5 text-[10px] text-brand">Click to see its edits</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {overflow > 0 && (
        <span className="ml-1 text-[10px] font-medium text-muted">+{overflow}</span>
      )}
    </div>
  );
}
