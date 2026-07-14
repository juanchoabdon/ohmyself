"use client";

import { useEffect, useState } from "react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { Bot, Wifi, WifiOff } from "lucide-react";
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
};

export type CollabSyncStatus = "connecting" | "synced" | "offline";

function readPeers(provider: HocuspocusProvider, localUser: CollabUser): PresencePeer[] {
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
    });
  }
  return peers.sort((a, b) => Number(b.isLocal) - Number(a.isLocal));
}

function syncLabel(status: CollabSyncStatus): string {
  if (status === "synced") return "Live";
  if (status === "connecting") return "Connecting…";
  return "Offline";
}

export function PresenceBar({
  provider,
  localUser,
  syncStatus,
  extraPeers = [],
  onSelectPeer,
  className,
}: {
  provider: HocuspocusProvider;
  localUser: CollabUser;
  syncStatus: CollabSyncStatus;
  /** Agents / recent editors not on the Yjs socket yet (until MCP→Y bridge). */
  extraPeers?: PresencePeer[];
  onSelectPeer?: (peer: PresencePeer) => void;
  className?: string;
}) {
  const [livePeers, setLivePeers] = useState<PresencePeer[]>(() => readPeers(provider, localUser));

  useEffect(() => {
    const bump = () => setLivePeers(readPeers(provider, localUser));
    provider.awareness?.on("change", bump);
    bump();
    return () => provider.awareness?.off("change", bump);
  }, [provider, localUser]);

  const seen = new Set<string>();
  const merged: PresencePeer[] = [];
  for (const p of [...livePeers, ...extraPeers]) {
    const key = p.id ?? `${p.kind}:${p.name}:${p.clientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }

  if (merged.length <= 1 && syncStatus === "synced") return null;

  return (
    <div
      className={cn(
        "mb-3 flex items-center justify-between gap-3 rounded-lg border border-border/80 bg-bg/50 px-2.5 py-1.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex -space-x-2">
          {merged.map((peer) => (
            <button
              key={`${peer.clientId}-${peer.id ?? peer.name}`}
              type="button"
              title={peer.isLocal ? `${peer.name} (you)` : peer.name}
              onClick={() => onSelectPeer?.(peer)}
              className={cn(
                "relative grid h-7 w-7 place-items-center rounded-full border-2 border-surface text-[10px] font-semibold text-white shadow-sm transition-transform hover:z-10 hover:scale-105",
                onSelectPeer && peer.kind === "agent" && "cursor-pointer",
                !onSelectPeer && "cursor-default",
              )}
              style={{ backgroundColor: peer.color }}
              disabled={!onSelectPeer || peer.kind !== "agent"}
            >
              {peer.kind === "agent" ? (
                <Bot className="h-3.5 w-3.5" aria-hidden />
              ) : peer.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={peer.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span aria-hidden>{peer.name.slice(0, 1).toUpperCase()}</span>
              )}
              {peer.isLocal && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface bg-brand" />
              )}
            </button>
          ))}
        </div>
        <p className="truncate text-xs text-muted">
          {merged.length === 1
            ? "Only you here"
            : `${merged.length} editing`}
        </p>
      </div>
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide",
          syncStatus === "synced" && "text-vis-public",
          syncStatus === "connecting" && "text-muted",
          syncStatus === "offline" && "text-vis-secret",
        )}
        title={syncLabel(syncStatus)}
      >
        {syncStatus === "offline" ? (
          <WifiOff className="h-3 w-3" aria-hidden />
        ) : (
          <Wifi className="h-3 w-3" aria-hidden />
        )}
        {syncLabel(syncStatus)}
      </div>
    </div>
  );
}
