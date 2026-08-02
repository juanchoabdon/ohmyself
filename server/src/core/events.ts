export type BrainEventType =
  | "note_created"
  | "note_updated"
  | "note_deleted"
  | "note_moved"
  | "comment_created"
  | "comment_updated"
  | "comment_resolved"
  | "comment_deleted";

export interface BrainEvent {
  type: BrainEventType;
  spaceId: string;
  path: string;
  /** Destination path for note_moved. */
  to?: string;
  updated?: string;
  /** comment_* only: the comment that changed and the thread it belongs to. */
  commentId?: string;
  threadId?: string;
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
