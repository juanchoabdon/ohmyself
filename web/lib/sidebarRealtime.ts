import type { BrainEvent } from "./brainEvents";
import type { IndexedNote } from "./types";

/** Whether this event should change the sidebar tree (not a collab body autosave). */
export function isSidebarStructuralEvent(event: BrainEvent): boolean {
  if (event.type === "note_created" || event.type === "note_deleted" || event.type === "note_moved") {
    return true;
  }
  if (event.type === "note_updated") return event.summary !== "live edit";
  return false;
}

/** Top-level pillars touched by a vault event. */
export function pillarsForEvent(event: BrainEvent): string[] {
  const out = new Set<string>();
  const head = event.path.split("/").filter(Boolean)[0];
  if (head) out.add(head);
  if (event.to) {
    const dest = event.to.split("/").filter(Boolean)[0];
    if (dest) out.add(dest);
  }
  return [...out];
}

/** Apply instant local patches before the server re-fetch lands. */
export function applyInstantSidebarPatch(notes: IndexedNote[], event: BrainEvent): IndexedNote[] {
  if (event.type === "note_deleted") {
    return notes.filter((n) => n.path !== event.path);
  }
  if (event.type === "note_moved") {
    return notes.filter((n) => n.path !== event.path);
  }
  return notes;
}

export function mergeSidebarEvents(events: BrainEvent[]): {
  pillars: string[];
  instant: BrainEvent[];
} {
  const pillars = new Set<string>();
  const instant: BrainEvent[] = [];
  for (const event of events) {
    if (!isSidebarStructuralEvent(event)) continue;
    for (const p of pillarsForEvent(event)) pillars.add(p);
    if (event.type === "note_deleted" || event.type === "note_moved") instant.push(event);
  }
  return { pillars: [...pillars], instant };
}
