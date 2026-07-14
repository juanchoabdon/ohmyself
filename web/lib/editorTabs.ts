export type EditorTab = { path: string; title: string };

export function editorTabsKey(spaceId: string): string {
  return `oms-tabs:${spaceId}`;
}

export function loadEditorTabs(spaceId: string): EditorTab[] {
  try {
    const raw = localStorage.getItem(editorTabsKey(spaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is EditorTab =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as EditorTab).path === "string" &&
        typeof (t as EditorTab).title === "string",
    );
  } catch {
    return [];
  }
}

export function saveEditorTabs(spaceId: string, tabs: EditorTab[]): void {
  try {
    localStorage.setItem(editorTabsKey(spaceId), JSON.stringify(tabs));
  } catch {
    /* storage unavailable */
  }
}

export function upsertTab(tabs: EditorTab[], path: string, title: string): EditorTab[] {
  const i = tabs.findIndex((t) => t.path === path);
  if (i >= 0) {
    const next = [...tabs];
    next[i] = { path, title };
    return next;
  }
  return [...tabs, { path, title }];
}

export function closeTab(tabs: EditorTab[], path: string): EditorTab[] {
  return tabs.filter((t) => t.path !== path);
}

export function reorderTabs(tabs: EditorTab[], activePath: string, overPath: string): EditorTab[] {
  const oldIndex = tabs.findIndex((t) => t.path === activePath);
  const newIndex = tabs.findIndex((t) => t.path === overPath);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return tabs;
  const next = [...tabs];
  const [item] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, item!);
  return next;
}
