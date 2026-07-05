/**
 * Minimal note shape needed by the ported `BrainMap` component (see
 * ohmyself!/web/lib/types.ts, the source of truth). Only public notes ever
 * flow through here — see lib/brain.ts.
 */

export type Visibility = "public" | "private" | "secret";

export interface IndexedNote {
  path: string;
  title: string;
  type: string;
  visibility: Visibility;
  tags: string[];
  links: string[];
  created?: string;
  updated?: string;
  excerpt?: string;
}
