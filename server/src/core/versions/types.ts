import type { Visibility } from "../types.js";

export type VersionOp = "create" | "update" | "restore" | "delete" | "move";

export interface WriteAttribution {
  author: string;
  summary?: string;
  /** QUIÉN, la persona. `author` dice con qué se escribió ("human",
   *  "agent:Claude"), que en un brain compartido no distingue a nadie.
   *  Sale de la cuenta autenticada, así que vale igual desde MCP, desde la
   *  web o desde la API — el cliente no lo declara y no lo puede falsear. */
  person?: string;
}

export interface HistoryEntry {
  version: string;
  author: string;
  timestamp: number;
  summary: string;
  op: VersionOp;
  path: string;
}

export interface VersionRecordInput {
  path: string;
  title: string;
  visibility: Visibility;
  author: string;
  summary?: string;
  op: VersionOp;
  raw: string | null;
}

export interface VersionStore {
  record(spaceId: string, input: VersionRecordInput): Promise<string | null>;
  /** Latest version id for a note path, or null if none recorded yet. */
  latestRevision(
    spaceId: string,
    path: string,
    allowed: Visibility[],
  ): Promise<string | null>;
  history(
    spaceId: string,
    path: string,
    allowed: Visibility[],
    opts?: { limit?: number; offset?: number },
  ): Promise<HistoryEntry[]>;
  readAtVersion(
    spaceId: string,
    path: string,
    version: string,
    allowed: Visibility[],
  ): Promise<string | null>;
  recentActivity(
    spaceId: string,
    allowed: Visibility[],
    opts?: { limit?: number },
  ): Promise<HistoryEntry[]>;
}
