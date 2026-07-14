import type { Visibility } from "../types.js";
import type { HistoryEntry, VersionRecordInput, VersionStore } from "./types.js";

/** Disabled version history (VERSIONS_ENABLED=false). */
export class NoopVersionStore implements VersionStore {
  async record(): Promise<string | null> {
    return null;
  }
  async history(): Promise<HistoryEntry[]> {
    return [];
  }
  async readAtVersion(): Promise<string | null> {
    return null;
  }
  async recentActivity(): Promise<HistoryEntry[]> {
    return [];
  }
}
