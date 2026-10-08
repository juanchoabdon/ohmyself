/**
 * In-memory stand-in for the Supabase service client, for tests only.
 *
 * Implements the slice of the PostgREST query builder the provisioning,
 * token, membership and transcript-inbox code paths use: from / select /
 * insert / upsert / update / delete, the filters eq / is / lt / not / ilike,
 * order / limit / range, and the terminal maybeSingle / single. Builders are
 * thenable (awaitable) exactly like supabase-js. Unique indexes that matter
 * to idempotency are emulated: `spaces.external_key`,
 * `transcript_deltas (space_id, external_id)` and the `space_members` PK.
 *
 * Deliberately NOT a general PostgREST: anything outside what the server
 * actually calls throws loudly so a test never passes on a silent no-op.
 */

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = { data: unknown; error: { message: string } | null; count?: number };

const UNIQUE: Record<string, string[][]> = {
  spaces: [["external_key"], ["id"]],
  space_members: [["space_id", "user_id"]],
  transcript_deltas: [["space_id", "external_id"]],
  api_tokens: [["id"]],
  user_config: [["space_id"]],
};

export class FakeSupabase {
  readonly tables = new Map<string, Row[]>();

  table(name: string): Row[] {
    let t = this.tables.get(name);
    if (!t) {
      t = [];
      this.tables.set(name, t);
    }
    return t;
  }

  from(name: string): FakeQuery {
    return new FakeQuery(this, name);
  }

  /** Fake session tokens: `jwtFor(userId)` returns a bearer `auth.getUser`
   *  resolves to that user, so JWT-only routes can be exercised. */
  readonly jwts = new Map<string, string>();
  jwtFor(userId: string): string {
    const token = `jwt-${userId}`;
    this.jwts.set(token, userId);
    return token;
  }
  readonly auth = {
    getUser: async (token: string) => {
      const id = this.jwts.get(token);
      if (!id) return { data: { user: null }, error: { message: "invalid jwt" } };
      return { data: { user: { id } }, error: null };
    },
  };

  readonly storage = {
    from: () => {
      throw new Error("storage is not available in the fake supabase client");
    },
  };
}

function conflicts(a: Row, b: Row, cols: string[]): boolean {
  return cols.every((c) => a[c] != null && a[c] === b[c]);
}

function likeToRegex(pattern: string, flags = ""): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`, flags);
}

class FakeQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private singleMode: "maybe" | "one" | null = null;
  private returning = false;
  private selectCols = "*";
  private countMode: "exact" | null = null;
  private head = false;

  constructor(
    private db: FakeSupabase,
    private name: string,
  ) {}

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }): this {
    if (this.op === "select") this.selectCols = cols;
    this.returning = true;
    if (opts?.count) this.countMode = opts.count;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = "upsert";
    this.payload = rows;
    this.upsertOpts = opts;
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown): this {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  is(col: string, v: null | boolean): this {
    this.filters.push((r) => (v === null ? r[col] == null : r[col] === v));
    return this;
  }
  not(col: string, operator: string, v: unknown): this {
    if (operator === "is" && v === null) {
      this.filters.push((r) => r[col] != null);
    } else if (operator === "like") {
      const re = likeToRegex(String(v));
      this.filters.push((r) => !re.test(String(r[col] ?? "")));
    } else {
      throw new Error(`fake supabase: unsupported not(${operator})`);
    }
    return this;
  }
  lt(col: string, v: unknown): this {
    this.filters.push((r) => (r[col] as string) < (v as string));
    return this;
  }
  ilike(col: string, v: string): this {
    const re = likeToRegex(v, "i");
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orders.push({ col, asc: opts.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.lim = n;
    return this;
  }
  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  maybeSingle(): this {
    this.singleMode = "maybe";
    return this;
  }
  single(): this {
    this.singleMode = "one";
    return this;
  }

  private matching(rows: Row[]): Row[] {
    let out = rows.filter((r) => this.filters.every((f) => f(r)));
    for (const o of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => {
        const x = a[o.col] as string | number;
        const y = b[o.col] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
      });
    }
    if (this.rangeFrom !== null) out = out.slice(this.rangeFrom, (this.rangeTo ?? out.length) + 1);
    if (this.lim !== null) out = out.slice(0, this.lim);
    return out;
  }

  /** PostgREST embeds: `role, spaces:space_id (cols)` → attach the parent row. */
  private project(row: Row): Row {
    const m = /(\w+):(\w+)\s*\(/.exec(this.selectCols);
    if (!m) return { ...row };
    const alias = m[1] as string;
    const fk = m[2] as string;
    const parent = this.db.table(alias).find((p) => p.id === row[fk]) ?? null;
    return { ...row, [alias]: parent ? { ...parent } : null };
  }

  private finish(rows: Row[]): Result {
    if (this.singleMode === "one") {
      if (rows.length !== 1) return { data: null, error: { message: `expected one row, got ${rows.length}` } };
      return { data: rows[0], error: null };
    }
    if (this.singleMode === "maybe") {
      if (rows.length > 1) return { data: null, error: { message: "more than one row" } };
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  private run(): Result {
    const table = this.db.table(this.name);

    if (this.op === "select") {
      const rows = this.matching(table).map((r) => this.project(r));
      if (this.countMode) return { data: this.head ? null : rows, error: null, count: rows.length };
      return this.finish(rows);
    }

    if (this.op === "insert" || this.op === "upsert") {
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const written: Row[] = [];
      for (const raw of incoming) {
        const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...raw };
        const keys = UNIQUE[this.name] ?? [];
        const clash = table.find((existing) => keys.some((cols) => conflicts(existing, row, cols)));
        if (clash) {
          if (this.op === "insert") {
            return {
              data: null,
              error: { message: `duplicate key value violates unique constraint on ${this.name}` },
            };
          }
          if (this.upsertOpts.ignoreDuplicates) continue;
          Object.assign(clash, raw);
          written.push(clash);
          continue;
        }
        table.push(row);
        written.push(row);
      }
      return this.returning ? this.finish(written) : { data: null, error: null };
    }

    if (this.op === "update") {
      const rows = this.matching(table);
      for (const r of rows) Object.assign(r, this.payload as Row);
      return this.returning ? this.finish(rows) : { data: null, error: null };
    }

    const rows = this.matching(table);
    for (const r of rows) table.splice(table.indexOf(r), 1);
    return { data: null, error: null };
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((v: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }
}
