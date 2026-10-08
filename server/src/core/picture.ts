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

/**
 * Puro: funde lo que el modelo devolvió con lo que había.
 *
 * Sección por sección: la que vuelve reemplaza a la del mismo nombre (el
 * modelo la escribió completa, fundida); la que NO vuelve se conserva tal
 * cual; una nueva se agrega al final. El orden es el de la foto previa. Así
 * un día de ruido (modelo devuelve "" o una sola sección) no borra nada.
 */
export function mergePictureRest(previousRest: string, updateRest: string): string {
  if (!previousRest.trim()) return updateRest.trim();
  if (!updateRest.trim()) return previousRest.trim();
  const prev = splitSections(previousRest);
  const upd = splitSections(updateRest);
  const used = new Set<number>();
  const sections = prev.sections.map((s) => {
    const key = sectionKey(s.title);
    const i = upd.sections.findIndex((u, j) => !used.has(j) && sectionKey(u.title) === key);
    const replacement = i < 0 ? undefined : upd.sections[i];
    if (!replacement) return s;
    used.add(i);
    return replacement;
  });
  upd.sections.forEach((u, j) => {
    if (!used.has(j)) sections.push(u);
  });
  return joinSections({ preamble: upd.preamble || prev.preamble, sections });
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
    if (/^[-*] /.test(line) && cur.length) {
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
    horizon.body = keep.join("\n");
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
  if (closed) closed.body = splitBullets(closed.body).slice(0, MAX_CLOSED_ITEMS).join("\n");
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
}): string {
  const prevRest = pictureWithoutIdentity(input.previous);
  const updRest = input.update.trim() ? pictureWithoutIdentity(input.update) : "";
  const merged = updRest ? mergePictureRest(prevRest, updRest) : prevRest;
  const rest = merged.trim() ? retireExpiredHorizon(merged, input.day) : "";
  return composePicture(input.previous, input.identity, rest);
}
