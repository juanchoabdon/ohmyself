import type { Brain, UserConfig, Visibility } from "../core/index.js";

/** Everything a connector needs to read/write a brain, scoped to a space. */
export interface ConnectorContext {
  /** The space (self or company brain) this connector ingests into. */
  spaceId: string;
  brain: Brain;
  allowed: Visibility[];
  config: UserConfig;
}

export interface PullResult {
  created: string[];
  updated: string[];
  skipped: string[];
}

/** A bidirectional integration with an external tool. `pull` brings data into
 *  the brain; the optional `push` exports brain data outward. Add a new tool by
 *  implementing this interface and registering it in connectors/index.ts. */
export interface Connector<Options = Record<string, unknown>> {
  id: string;
  label: string;
  description: string;
  pull(ctx: ConnectorContext, options?: Options): Promise<PullResult>;
  push?(ctx: ConnectorContext, options?: Options): Promise<void>;
}

export function emptyResult(): PullResult {
  return { created: [], updated: [], skipped: [] };
}
