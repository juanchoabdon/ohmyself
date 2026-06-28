export type Visibility = "public" | "private" | "secret";

export interface IndexedNote {
  path: string;
  id?: string;
  title: string;
  type: string;
  visibility: Visibility;
  tags: string[];
  links: string[];
  created?: string;
  updated?: string;
  excerpt?: string;
}

export interface NoteMeta {
  id?: string;
  title: string;
  type: string;
  visibility: Visibility;
  tags: string[];
  links: string[];
  created?: string;
  updated?: string;
}

export interface FullNote {
  path: string;
  meta: NoteMeta;
  body: string;
  raw: string;
}

export interface ContextResult {
  topic: string;
  notes: { path: string; title: string; body: string }[];
  text: string;
}
