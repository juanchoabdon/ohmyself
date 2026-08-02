/**
 * Which tab is showing, for each tabs block in the document.
 *
 * This can't be React context: TipTap renders every node view into its own
 * portal off `EditorContent`, so a `tab` node view is a *sibling* of its
 * `tabs` parent in the React tree and never sees a provider the parent renders.
 *
 * It can't be a node attribute either — writing to the document to record which
 * tab someone is looking at would dirty the note, trigger a save, and sync the
 * change to everyone else in the collab room.
 *
 * So it lives here, keyed by the tabs node's document position. Both sides
 * derive that key from the same position, so they always agree. Editing text
 * above a tabs block shifts its position and the selection falls back to the
 * first tab, which is a fair price for never touching the document.
 */

const active = new Map<string, number>();
const listeners = new Set<() => void>();

export function subscribeTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function activeTab(key: string): number {
  return active.get(key) ?? 0;
}

export function setActiveTab(key: string, index: number): void {
  if (active.get(key) === index) return;
  active.set(key, index);
  for (const listener of listeners) listener();
}
