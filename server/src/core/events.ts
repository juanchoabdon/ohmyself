export type BrainEventType = "note_created" | "note_updated" | "note_deleted" | "note_moved";

export interface BrainEvent {
  type: BrainEventType;
  spaceId: string;
  path: string;
  /** Destination path for note_moved. */
  to?: string;
  updated?: string;
}

type Listener = (event: BrainEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeBrainEvents(spaceId: string, listener: Listener): () => void {
  let set = listeners.get(spaceId);
  if (!set) {
    set = new Set();
    listeners.set(spaceId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(spaceId);
  };
}

export function emitBrainEvent(event: BrainEvent): void {
  const set = listeners.get(event.spaceId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      /* listener error should not break writers */
    }
  }
}
