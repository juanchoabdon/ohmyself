/**
 * La foto viva de una relación (`memory/relationship.md`) como ESTADO
 * ACUMULADO, no como resumen del último día.
 *
 * Diagnóstico (JD, 2026-10-07, room jess & juandi): el prompt decía que
 * `relationship_update` era "full replacement… anything you leave out is
 * erased", el modelo veía un solo día de transcript y reescribía la foto con
 * ese día. Un mes de contexto (maratón, viaje, carta legal, renuncia planeada)
 * se perdió en una sola pasada. Un amigo que lleva el hilo no funciona así:
 * sabe qué le pasa a cada uno AHORA aunque hoy nadie lo haya mencionado.
 *
 * Este módulo es la red determinista debajo del prompt nuevo:
 *   - `mergePictureRest`: lo que el modelo devuelve se FUNDE sección por
 *     sección con lo que había; una sección que no vuelve se conserva tal cual.
 *     Un día de ruido no borra la situación anterior aunque el modelo devuelva
 *     poco.
 *   - `retireExpiredHorizon`: una fecha de "En el horizonte" que ya pasó baja
 *     sola a "Cerrado recientemente", con fecha. Lo pasado no se confunde con
 *     lo vigente aunque el modelo se lo salte.
 *   - `composePicture`: la identidad ("Qué es este grupo") se compone acá y
 *     nunca la escribe el modelo dentro del cuerpo.
 *
 * Todo es puro y se prueba sin modelo en `picture.test.ts`.
 */

/// El encabezado de la sección de identidad dentro de la foto.
export const GROUP_IDENTITY_HEADING = "# Qué es este grupo";

/// Dónde cae lo que ya pasó. Corta: las últimas MAX_CLOSED_ITEMS entradas.
export const CLOSED_HEADING = "## Cerrado recientemente";
export const MAX_CLOSED_ITEMS = 8;

/** Puro: la identidad que ya está en la foto, o "" si la nota no la trae. */
export function identityFromPicture(body: string): string {
  const i = body.indexOf(GROUP_IDENTITY_HEADING);
  if (i < 0) return "";
  const after = body.slice(i + GROUP_IDENTITY_HEADING.length);
  const next = after.search(/\n#{1,2} /);
  return (next < 0 ? after : after.slice(0, next)).trim();
}

/** Puro: el resto de la foto, sin la sección de identidad. */
export function pictureWithoutIdentity(body: string): string {
  const i = body.indexOf(GROUP_IDENTITY_HEADING);
  if (i < 0) return body.trim();
  const after = body.slice(i + GROUP_IDENTITY_HEADING.length);
  const next = after.search(/\n#{1,2} /);
  const rest = next < 0 ? "" : after.slice(next);
  return `${body.slice(0, i)}${rest}`.trim();
}

/**
 * Puro: la foto completa = identidad arriba, el resto debajo.
 *
 * La identidad se compone acá y no la escribe el modelo dentro del cuerpo: un
 * párrafo de instrucciones se lo salta cualquiera (gpt-4o-mini copiaba la
 * "Situación" tal cual; el modelo grande devolvía vacío), un campo propio no.
 */
export function composePicture(previousBody: string, identity: string, rest: string): string {
  const keptIdentity = identity.trim() || identityFromPicture(previousBody);
  const body = (rest.trim() ? pictureWithoutIdentity(rest) : pictureWithoutIdentity(previousBody)).trim();
  if (!keptIdentity) return body;
  return [`${GROUP_IDENTITY_HEADING}`, ``, keptIdentity, ``, body].join("\n").trim();
}

// ── Secciones ───────────────────────────────────────────────────────────────

export interface PictureSection {
  /** La línea de encabezado tal cual ("## Situación"). */
  heading: string;
  /** El título sin almohadillas. */
  title: string;
  body: string;
}

export interface SplitPicture {
  /** Texto antes del primer encabezado. */
  preamble: string;
  sections: PictureSection[];
}

const HEADING_RE = /^#{1,2} +(.+?)\s*$/;

/** Puro: parte el resto de la foto en preámbulo + secciones (`#` o `##`). */
export function splitSections(rest: string): SplitPicture {
  const lines = rest.replace(/\r\n/g, "\n").split("\n");
  const out: SplitPicture = { preamble: "", sections: [] };
  const pre: string[] = [];
  const buf: string[] = [];
  let cur: PictureSection | null = null;
  const flush = () => {
    if (!cur) return;
    cur.body = buf.join("\n").trim();
    out.sections.push(cur);
    buf.length = 0;
  };
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      flush();
      cur = { heading: line.trim(), title: (m[1] ?? "").trim(), body: "" };
      continue;
    }
    if (cur) buf.push(line);
    else pre.push(line);
  }
  flush();
  out.preamble = pre.join("\n").trim();
  return out;
}

/** Puro: la clave de una sección — sin tildes, minúsculas, sin puntuación —
 *  para que "Situación", "situacion" y "## Situación:" sean la misma. */
export function sectionKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function joinSections(p: SplitPicture): string {
  const parts: string[] = [];
  if (p.preamble.trim()) parts.push(p.preamble.trim());
  for (const s of p.sections) parts.push(s.body.trim() ? `${s.heading}\n\n${s.body.trim()}` : s.heading);
  return parts.join("\n\n").trim();
}

// ── Ids: nada desaparece en silencio ────────────────────────────────────────

/** `[S2]`, `[C14]`: el id de un ítem de la foto previa, asignado al armar el
 *  prompt y quitado al guardar. Estable solo dentro de una llamada. */
const ID_RE = /\[([A-Z]{1,2}\d{1,3})\]/g;
const BULLET_RE = /^([-*] +)/;

/** Puro: la letra de los ids de una sección (S = Situación, C = Contexto,
 *  D = Dinámicas, H = Horizonte, X = Cerrado, si no la inicial). */
export function sectionPrefix(title: string): string {
  const k = sectionKey(title);
  if (/situaci|situation/.test(k)) return "S";
  if (/contexto|context/.test(k)) return "C";
  if (/dinamic|dynamic/.test(k)) return "D";
  if (/horizon/.test(k)) return "H";
  if (/cerrad|closed/.test(k)) return "X";
  return (k[0] ?? "Z").toUpperCase();
}

/** Puro: la foto previa con cada bullet etiquetado — `- [S1] …` — tal como la
 *  ve el modelo. Determinista: la misma foto da los mismos ids, así que el
 *  merge la re-etiqueta y reconoce lo que el modelo devolvió. */
export function annotateIds(rest: string): string {
  const p = splitSections(rest);
  for (const sec of p.sections) {
    const prefix = sectionPrefix(sec.title);
    let n = 0;
    sec.body = splitBullets(sec.body)
      .map((item) => {
        const m = BULLET_RE.exec(item);
        if (!m) return item;
        n += 1;
        return `${m[1]}[${prefix}${n}] ${item.slice(m[0].length)}`;
      })
      .join("\n");
  }
  return joinSections(p);
}

export function idsIn(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(ID_RE), (m) => m[1] ?? ""));
}

export function stripIds(text: string): string {
  return text
    .replace(/(\[[A-Z]{1,2}\d{1,3}\])+ ?/g, "")
    .replace(/^([-*]) {2,}/gm, "$1 ");
}

/** Los bloques de una sección: lo que hay bajo cada sub-encabezado `###`
 *  (null = antes del primero). Para devolver un ítem conservado a SU persona
 *  en "Contexto de cada uno" y no al final de la sección. */
function blocksOf(body: string): { sub: string | null; items: string[] }[] {
  const blocks: { sub: string | null; items: string[] }[] = [{ sub: null, items: [] }];
  for (const item of splitBullets(body)) {
    if (/^#{3,} /.test(item)) blocks.push({ sub: item.split("\n")[0]?.trim() ?? item, items: [item] });
    else blocks[blocks.length - 1]!.items.push(item);
  }
  return blocks;
}

function joinBlocks(blocks: { sub: string | null; items: string[] }[]): string {
  return blocks
    .map((b) => b.items.join("\n"))
    .filter((t) => t.trim())
    .join("\n\n");
}

/**
 * Puro: funde lo que el modelo devolvió con lo que había.
 *
 * Sección por sección: la que vuelve reemplaza a la del mismo nombre; la que
 * NO vuelve se conserva; una nueva se agrega al final. Y dentro de una sección
 * que vuelve, NADA DESAPARECE EN SILENCIO: cada bullet previo lleva un id, y
 * el que no aparece en ninguna parte de la respuesta (ni refinado, ni movido
 * a "Cerrado recientemente", ni en `drop`) se conserva tal cual, bajo su
 * mismo sub-encabezado. gpt-5.2 con el contrato de merge en el prompt seguía
 * recortando la foto a la mitad en días flojos (dry-run 2026-10-07: 6038 →
 * 3527 chars, la renuncia del 15 nov desapareció); esto lo hace imposible.
 */
export function mergePictureRest(previousRest: string, updateRest: string, drop: string[] = []): string {
  if (!previousRest.trim()) return stripIds(updateRest.trim());
  if (!updateRest.trim() && drop.length === 0) return previousRest.trim();
  const prev = splitSections(annotateIds(previousRest));
  const upd = splitSections(updateRest);
  const accounted = idsIn(updateRest);
  for (const id of drop) accounted.add(id);
  const hasId = (item: string) => Array.from(idsIn(item)).some((id) => accounted.has(id));

  const used = new Set<number>();
  const sections = prev.sections.map((s) => {
    const key = sectionKey(s.title);
    const i = upd.sections.findIndex((u, j) => !used.has(j) && sectionKey(u.title) === key);
    if (i < 0) {
      // Not returned: kept, minus what the model moved elsewhere or dropped.
      const blocks = blocksOf(s.body).map((b) => ({ ...b, items: b.items.filter((it) => !hasId(it)) }));
      return { ...s, body: joinBlocks(blocks) };
    }
    used.add(i);
    const u = upd.sections[i]!;
    // Returned: the model's version, plus every previous bullet it did not
    // account for, each back under its own sub-heading.
    const next = blocksOf(u.body);
    for (const pb of blocksOf(s.body)) {
      const kept = pb.items.filter((it) => BULLET_RE.test(it) && !hasId(it));
      if (!kept.length) continue;
      let target = next.find((nb) => (nb.sub ?? "") === (pb.sub ?? ""));
      if (!target) {
        target = { sub: pb.sub, items: pb.sub ? [pb.sub] : [] };
        next.push(target);
      }
      target.items.push(...kept);
    }
    return { heading: u.heading, title: u.title, body: joinBlocks(next) };
  });
  upd.sections.forEach((u, j) => {
    if (!used.has(j)) sections.push(u);
  });
  return stripIds(joinSections({ preamble: upd.preamble || prev.preamble, sections }));
}

// ── Horizonte → cerrado ─────────────────────────────────────────────────────

const isHorizon = (s: PictureSection) => /horizon/.test(sectionKey(s.title));
const isClosed = (s: PictureSection) => /cerrad|closed/.test(sectionKey(s.title));

/** Un ítem del horizonte empieza con su fecha objetivo: `- 2026-11-15 — …` o
 *  `- 2026-11 — …` cuando solo se sabe el mes. Las negritas no estorban. */
const DATED_BULLET_RE = /^[-*] +\**(\d{4}-\d{2}(?:-\d{2})?)\**/;

/** Puro: parte el cuerpo de una sección en ítems (un bullet y sus líneas de
 *  continuación). Lo que precede al primer bullet es un ítem propio. */
export function splitBullets(body: string): string[] {
  const items: string[] = [];
  let cur: string[] = [];
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if ((/^[-*] /.test(line) || /^#{3,} /.test(line)) && cur.length) {
      items.push(cur.join("\n").trim());
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length) items.push(cur.join("\n").trim());
  return items.filter((it) => it.length > 0);
}

/** Vencido = la fecha quedó estrictamente ANTES del día que se está
 *  destilando. Con solo mes, vencido cuando el mes entero quedó atrás. */
export function isExpired(date: string, day: string): boolean {
  if (date.length === 7) return date < day.slice(0, 7);
  return date < day;
}

/** Las palabras que pesan de un ítem: sin fecha al frente, sin evidencia
 *  entre paréntesis, sin tildes, solo tokens de 4+ letras. */
function significantTokens(item: string): Set<string> {
  const text = item
    .replace(/^[-*] +\**\d{4}-\d{2}(?:-\d{2})?\**/, "")
    .replace(RETIRED_SUFFIX_RE, "")
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return new Set(text.match(/[a-z0-9]{4,}/g) ?? []);
}

/** Puro: dos ítems son el mismo si comparten la fecha al frente (o ninguno la
 *  tiene) y la mitad de sus palabras. Se queda el más rico (más largo), en la
 *  posición del primero. El modelo escribe "2026-09-27 — Jess terminó el
 *  maratón" en Cerrado sin el id del horizonte, y el keeper además retira el
 *  del horizonte: sin esto quedan dos. */
const RETIRED_SUFFIX_RE = / — pasó; salió del horizonte el \d{4}-\d{2}-\d{2}\s*$/;

/** Qué tan rico es un ítem para quedarse: lo que escribió el modelo gana sobre
 *  lo retirado automáticamente; a igual origen, el más largo. */
function richness(item: string): number {
  const own = !RETIRED_SUFFIX_RE.test(item);
  return item.replace(RETIRED_SUFFIX_RE, "").length + (own ? 10_000 : 0);
}

export function dedupeItems(items: string[]): string[] {
  const kept: { item: string; date: string; tokens: Set<string> }[] = [];
  for (const item of items) {
    const date = DATED_BULLET_RE.exec(item)?.[1] ?? "";
    const tokens = significantTokens(item);
    const dup = kept.find((k) => {
      if (k.date !== date || tokens.size === 0 || k.tokens.size === 0) return false;
      let shared = 0;
      for (const t of tokens) if (k.tokens.has(t)) shared += 1;
      const smaller = Math.min(tokens.size, k.tokens.size);
      // Three shared words and half of the smaller one; tiny items only when identical.
      return shared === smaller || (shared >= 3 && shared / smaller >= 0.5);
    });
    if (!dup) kept.push({ item, date, tokens });
    else if (richness(item) > richness(dup.item)) Object.assign(dup, { item, tokens });
  }
  return kept.map((k) => k.item);
}

/**
 * Puro: lo que en "En el horizonte" ya pasó baja a "Cerrado recientemente",
 * fechado; "Cerrado recientemente" se recorta a MAX_CLOSED_ITEMS (lo más
 * nuevo arriba). Devuelve el resto normalizado aunque no haya nada que mover.
 */
export function retireExpiredHorizon(rest: string, day: string): string {
  const p = splitSections(rest);
  const horizon = p.sections.find(isHorizon);
  const expired: string[] = [];
  if (horizon) {
    const keep: string[] = [];
    for (const item of splitBullets(horizon.body)) {
      const date = DATED_BULLET_RE.exec(item)?.[1];
      if (date && isExpired(date, day)) expired.push(item);
      else keep.push(item);
    }
    horizon.body = dedupeItems(keep).join("\n");
  }
  let closed = p.sections.find(isClosed);
  if (expired.length) {
    if (!closed) {
      closed = { heading: CLOSED_HEADING, title: "Cerrado recientemente", body: "" };
      p.sections.push(closed);
    }
    const moved = expired.map((e) => `${e.trimEnd()} — pasó; salió del horizonte el ${day}`);
    closed.body = [...moved, ...splitBullets(closed.body)].join("\n");
  }
  if (closed) closed.body = dedupeItems(splitBullets(closed.body)).slice(0, MAX_CLOSED_ITEMS).join("\n");
  if (horizon && !horizon.body.trim()) p.sections = p.sections.filter((s) => s !== horizon);
  return joinSections(p);
}

/**
 * Puro: la foto siguiente a partir de la previa, lo que el modelo devolvió
 * (identidad y/o actualización del resto, cualquiera puede ser "") y el día.
 *
 *   previa ─┬─ merge(update) ─ retirar vencidos ─┬─ componer con identidad
 *           └─ (update vacío: el resto queda)  ──┘
 */
export function nextPicture(input: {
  previous: string;
  identity: string;
  update: string;
  day: string;
  /** Ids the model named as wrong or contradicted — the only way to delete. */
  drop?: string[];
}): string {
  const prevRest = pictureWithoutIdentity(input.previous);
  const updRest = input.update.trim() ? pictureWithoutIdentity(input.update) : "";
  const drop = input.drop ?? [];
  const merged = updRest || drop.length ? mergePictureRest(prevRest, updRest, drop) : prevRest;
  const rest = merged.trim() ? retireExpiredHorizon(merged, input.day) : "";
  return composePicture(input.previous, input.identity, rest);
}
