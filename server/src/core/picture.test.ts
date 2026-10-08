// La foto viva es un estado ACUMULADO: un día flojo no la borra, un día que
// contradice la actualiza con fecha, y lo que ya pasó baja a "Cerrado
// recientemente" solo. Run with `pnpm --filter @ohmyself/server test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOSED_HEADING,
  annotateIds,
  dedupeItems,
  GROUP_IDENTITY_HEADING,
  MAX_CLOSED_ITEMS,
  composePicture,
  identityFromPicture,
  mergePictureRest,
  nextPicture,
  pictureWithoutIdentity,
  retireExpiredHorizon,
  splitBullets,
  splitSections,
} from "./picture.js";

const IDENTITY = "Jess y Juandi son pareja; este chat es su día a día y sus planes.";

const PREVIOUS = `${GROUP_IDENTITY_HEADING}

${IDENTITY}

## Situación

- Están a distancia: Jess en Berlín por el maratón, Juandi en Bogotá (inferido, 2026-09-26: ella mandó la foto del dorsal).
- Juandi anda tenso con Arnold y la carta legal a Flimp-Globa (inferido, 2026-10-01: lo contó en la noche).

## Contexto de cada uno

### Jess

- Entrenando para el maratón de Berlín; nerviosa pero contenta (dicho, 2026-09-20).

### Juandi

- Reuniones con los abogados por la carta a Flimp-Globa (dicho, 2026-10-01).

## Dinámicas

- Se mandan audios largos de noche para contarse el día (inferido, 2026-09-15).

## En el horizonte

- 2026-09-27 — Jess corre el maratón de Berlín (dicho, 2026-09-20).
- 2026-10-03 — Los dos en Roma, Coliseo (dicho, 2026-09-28).
- 2026-11-15 — Juandi planea renunciar (dicho, 2026-10-02).`;

// ── Un día de ruido no borra la situación anterior ───────────────────────────

test("un día de ruido (update vacío, identidad vacía) deja la foto como estaba", () => {
  const next = nextPicture({ previous: PREVIOUS, identity: "", update: "", day: "2026-09-26" });
  assert.ok(next.includes("maratón de Berlín"));
  assert.ok(next.includes("carta legal a Flimp-Globa"));
  assert.ok(next.includes("2026-11-15 — Juandi planea renunciar"));
  assert.equal(identityFromPicture(next), IDENTITY);
  assert.ok(next.includes("## Dinámicas"), "las secciones que el modelo no devolvió siguen ahí");
});

test("un día que solo trae una sección conserva todas las otras", () => {
  const update = `## Dinámicas\n\n- Se mandan audios largos de noche (inferido, 2026-09-15).\n- Jess manda stickers de gatos cuando Juandi se pone serio (inferido, 2026-09-26).`;
  const next = nextPicture({ previous: PREVIOUS, identity: "", update, day: "2026-09-26" });
  assert.ok(next.includes("stickers de gatos"), "lo nuevo entra");
  assert.ok(next.includes("Juandi anda tenso con Arnold"), "la Situación no se tocó");
  assert.ok(next.includes("### Jess"), "el contexto por persona no se tocó");
  assert.ok(next.includes("2026-11-15 — Juandi planea renunciar"), "el horizonte no se tocó");
  assert.equal(next.match(/## Dinámicas/g)?.length, 1, "la sección se reemplaza, no se duplica");
});

test("el modelo no puede borrar la foto devolviendo prosa suelta sin secciones", () => {
  const next = nextPicture({ previous: PREVIOUS, identity: "", update: "Hoy hablaron poco.", day: "2026-09-26" });
  assert.ok(next.includes("## Situación"));
  assert.ok(next.includes("maratón de Berlín"));
  assert.ok(next.includes("Hoy hablaron poco."), "la prosa queda como preámbulo, no reemplaza nada");
});

// ── Un día que contradice la actualiza con fecha ─────────────────────────────

test("un ítem que vuelve con su id reemplaza al anterior: la contradicción gana, con su fecha", () => {
  const update = `## Situación

- [S1] Ya no están a distancia: los dos en Roma desde el 3 de octubre (dicho, 2026-10-03: foto en el Coliseo).
- [S2] Juandi cerró el tema de la carta a Flimp-Globa: "the job is done" (dicho, 2026-10-05).`;
  const next = nextPicture({ previous: PREVIOUS, identity: "", update, day: "2026-10-05" });
  assert.ok(next.includes("los dos en Roma desde el 3 de octubre"));
  assert.ok(next.includes("(dicho, 2026-10-05)"), "la actualización trae su fecha");
  assert.ok(!next.includes("Están a distancia"), "la versión vieja de la Situación no queda al lado");
  assert.ok(!next.includes("[S1]"), "los ids no se guardan");
  assert.ok(next.includes("### Juandi"), "las otras secciones siguen");
  assert.ok(next.includes("- 2026-11-15 — Juandi planea renunciar"), "el horizonte vigente sigue");
});

test("las claves de sección ignoran tildes, mayúsculas y nivel de encabezado", () => {
  const merged = mergePictureRest(`## Situación\n\n- vieja`, `# situacion\n\n- [S1] nueva`);
  assert.ok(merged.includes("- nueva"));
  assert.ok(!merged.includes("- vieja"));
});

// ── Nada desaparece en silencio: ids ─────────────────────────────────────────

test("la foto va al modelo con cada bullet etiquetado, por sección y por orden", () => {
  const tagged = annotateIds(pictureWithoutIdentity(PREVIOUS));
  assert.ok(tagged.includes("- [S1] Están a distancia"));
  assert.ok(tagged.includes("- [S2] Juandi anda tenso"));
  assert.ok(tagged.includes("- [C1] Entrenando para el maratón"));
  assert.ok(tagged.includes("- [C2] Reuniones con los abogados"));
  assert.ok(tagged.includes("- [D1] Se mandan audios"));
  assert.ok(tagged.includes("- [H3] 2026-11-15"));
  assert.ok(tagged.includes("### Jess"), "los sub-encabezados no se etiquetan ni se pierden");
  assert.equal(annotateIds(pictureWithoutIdentity(PREVIOUS)), tagged, "determinista");
});

test("un ítem que el modelo omite al reescribir la sección se conserva igual", () => {
  const update = `## Situación\n\n- [S2] Juandi ya cerró lo de la carta (dicho, 2026-10-05).\n- Jess consiguió apartamento más barato (dicho, 2026-10-05).`;
  const next = nextPicture({ previous: PREVIOUS, identity: "", update, day: "2026-10-05" });
  assert.ok(next.includes("Están a distancia: Jess en Berlín"), "S1 no volvió → se conserva");
  assert.ok(next.includes("Juandi ya cerró lo de la carta"), "S2 refinado");
  assert.ok(!next.includes("Juandi anda tenso con Arnold"), "la versión vieja de S2 no queda");
  assert.ok(next.includes("Jess consiguió apartamento"), "lo nuevo entra");
  assert.ok(!/\[[A-Z]\d+\]/.test(next), "sin ids en la nota guardada");
});

test("un ítem conservado vuelve bajo SU persona en Contexto de cada uno", () => {
  const update = `## Contexto de cada uno\n\n### Jess\n\n- [C1] Corrió el maratón; ahora descansa (dicho, 2026-09-28).`;
  const next = nextPicture({ previous: PREVIOUS, identity: "", update, day: "2026-09-28" });
  const ctx = splitSections(pictureWithoutIdentity(next)).sections.find((s) => s.title === "Contexto de cada uno")!;
  const jess = ctx.body.indexOf("### Jess");
  const juandi = ctx.body.indexOf("### Juandi");
  const abogados = ctx.body.indexOf("Reuniones con los abogados");
  assert.ok(jess >= 0 && juandi > jess, "el sub-encabezado de Juandi se recreó después del de Jess");
  assert.ok(abogados > juandi, "C2 quedó bajo Juandi, no bajo Jess");
  assert.ok(ctx.body.includes("ahora descansa"));
  assert.equal(ctx.body.match(/### Juandi/g)?.length, 1);
});

test("un ítem movido a Cerrado con su id sale de su sección aunque esa sección no vuelva", () => {
  const update = `## Cerrado recientemente\n\n- [H1] 2026-09-27 — Jess corrió el maratón de Berlín: 05:03:32 (dicho, 2026-09-28).`;
  const next = nextPicture({ previous: PREVIOUS, identity: "", update, day: "2026-09-28" });
  const rest = pictureWithoutIdentity(next);
  const horizon = splitSections(rest).sections.find((s) => s.heading === "## En el horizonte")!;
  assert.ok(!horizon.body.includes("maratón"), "ya no está en el horizonte");
  assert.ok(horizon.body.includes("2026-11-15"), "lo demás del horizonte sigue");
  assert.ok(rest.includes("05:03:32"));
  assert.equal(rest.match(/maratón de Berlín/g)?.length, 2, "una vez en cerrado, una en el contexto de Jess");
});

test("borrar exige nombrar el id en drop; sin update también funciona", () => {
  const next = nextPicture({ previous: PREVIOUS, identity: "", update: "", drop: ["S2"], day: "2026-09-26" });
  assert.ok(!next.includes("Juandi anda tenso con Arnold"));
  assert.ok(next.includes("Están a distancia"));
});

test("dos ítems plegados en uno dan cuenta de ambos ids", () => {
  const update = `## Situación\n\n- [S1][S2] A distancia y Juandi tenso por la carta, las dos cosas siguen (inferido, 2026-10-01).`;
  const next = nextPicture({ previous: PREVIOUS, identity: "", update, day: "2026-10-01" });
  const sit = splitSections(pictureWithoutIdentity(next)).sections.find((s) => s.title === "Situación")!;
  assert.equal(splitBullets(sit.body).length, 1);
  assert.ok(sit.body.startsWith("- A distancia y Juandi tenso"));
});

test("una sección nueva se agrega al final sin tocar el orden de las demás", () => {
  const merged = mergePictureRest(`## A\n\n- a\n\n## B\n\n- b`, `## C\n\n- c`);
  const order = ["## A", "## B", "## C"].map((h) => merged.indexOf(h));
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  assert.ok(merged.includes("- a") && merged.includes("- b") && merged.includes("- c"));
});

// ── Una fecha futura vencida pasa a cerrado ──────────────────────────────────

test("lo que estaba en el horizonte y ya pasó baja a Cerrado recientemente, fechado", () => {
  const next = nextPicture({ previous: PREVIOUS, identity: "", update: "", day: "2026-10-05" });
  const closed = splitSections(pictureWithoutIdentity(next)).sections.find((s) => s.heading === CLOSED_HEADING);
  assert.ok(closed, "se creó la sección");
  assert.ok(closed!.body.includes("2026-09-27 — Jess corre el maratón de Berlín"));
  assert.ok(closed!.body.includes("2026-10-03 — Los dos en Roma"));
  assert.ok(closed!.body.includes("salió del horizonte el 2026-10-05"));
  const horizon = splitSections(pictureWithoutIdentity(next)).sections.find((s) => s.heading === "## En el horizonte");
  assert.ok(horizon, "el horizonte sigue porque todavía tiene algo vigente");
  assert.ok(horizon!.body.includes("2026-11-15 — Juandi planea renunciar"));
  assert.ok(!horizon!.body.includes("maratón"), "lo vencido ya no está en el horizonte");
});

test("el día mismo del evento todavía no vence; el siguiente sí", () => {
  const rest = `## En el horizonte\n\n- 2026-09-27 — maratón.`;
  assert.ok(retireExpiredHorizon(rest, "2026-09-27").includes("## En el horizonte"));
  const after = retireExpiredHorizon(rest, "2026-09-28");
  assert.ok(!after.includes("## En el horizonte"), "el horizonte vacío no queda colgando");
  assert.ok(after.includes(`${CLOSED_HEADING}\n\n- 2026-09-27 — maratón. — pasó; salió del horizonte el 2026-09-28`));
});

test("una fecha de solo mes vence cuando el mes entero quedó atrás", () => {
  const rest = `## En el horizonte\n\n- 2026-10 — mudanza a Ámsterdam.\n- 2026-11 — renuncia.`;
  const oct = retireExpiredHorizon(rest, "2026-10-20");
  assert.ok(oct.includes("- 2026-10 — mudanza") && !oct.includes(CLOSED_HEADING), "en octubre sigue vigente");
  const nov = retireExpiredHorizon(rest, "2026-11-01");
  assert.ok(nov.includes(`${CLOSED_HEADING}\n\n- 2026-10 — mudanza`));
  assert.ok(nov.includes("## En el horizonte\n\n- 2026-11 — renuncia."));
});

test("un bullet sin fecha al frente no se toca aunque mencione fechas viejas", () => {
  const rest = `## En el horizonte\n\n- Juandi planea renunciar a mediados de noviembre (dicho, 2026-10-02).`;
  assert.ok(retireExpiredHorizon(rest, "2026-10-05").includes("## En el horizonte"));
});

test("Cerrado recientemente se recorta: lo nuevo arriba, lo más viejo cae", () => {
  const words = ["alfa", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "julieta"];
  const old = Array.from({ length: MAX_CLOSED_ITEMS }, (_, i) => `- viejo ${i} ${words[i]} ${words[i + 1]}`).join("\n");
  const rest = `## En el horizonte\n\n- 2026-09-01 — algo.\n\n${CLOSED_HEADING}\n\n${old}`;
  const closed = splitSections(retireExpiredHorizon(rest, "2026-09-10")).sections.find((s) => s.heading === CLOSED_HEADING)!;
  const items = splitBullets(closed.body);
  assert.equal(items.length, MAX_CLOSED_ITEMS);
  assert.ok(items[0]?.startsWith("- 2026-09-01 — algo."));
  assert.ok(!closed.body.includes(`viejo ${MAX_CLOSED_ITEMS - 1}`), "el más viejo cayó");
});

// ── La identidad se compone, no la escribe el modelo ─────────────────────────

test("la identidad sobrevive al update y una nueva la reemplaza", () => {
  const same = nextPicture({ previous: PREVIOUS, identity: "", update: "## Situación\n\n- x", day: "2026-09-26" });
  assert.equal(identityFromPicture(same), IDENTITY);
  const changed = nextPicture({ previous: PREVIOUS, identity: "Otra identidad.", update: "", day: "2026-09-26" });
  assert.equal(identityFromPicture(changed), "Otra identidad.");
  assert.ok(changed.includes("## Situación"));
});

test("si el modelo cuela la identidad en el update, se descarta de ahí", () => {
  const update = `${GROUP_IDENTITY_HEADING}\n\nColada.\n\n## Situación\n\n- nueva`;
  const next = nextPicture({ previous: PREVIOUS, identity: "", update, day: "2026-09-26" });
  assert.equal(identityFromPicture(next), IDENTITY);
  assert.equal(next.match(new RegExp(GROUP_IDENTITY_HEADING, "g"))?.length, 1);
});

test("la primera foto de un room sin nada arranca de lo que trae el modelo", () => {
  const next = nextPicture({ previous: "", identity: "Son hermanos.", update: "## Situación\n\n- a", day: "2026-09-26" });
  assert.equal(next, composePicture("", "Son hermanos.", "## Situación\n\n- a"));
  assert.ok(next.startsWith(GROUP_IDENTITY_HEADING));
});

// ── Duplicados ───────────────────────────────────────────────────────────────

test("el mismo cierre escrito dos veces (modelo + retiro automático) queda una vez", () => {
  const rest = `## En el horizonte

- 2026-09-27 — Jess corre el BMW Berlin Marathon (dicho, 2026-09-20).

${CLOSED_HEADING}

- 2026-09-27 — Jess terminó el BMW Berlin Marathon con tiempo neto 05:03:32 (dicho, 2026-09-28: certificado).`;
  const out = retireExpiredHorizon(rest, "2026-09-28");
  assert.equal(out.match(/Berlin Marathon/g)?.length, 1);
  assert.ok(out.includes("05:03:32"), "se queda el que ya estaba en cerrado");
});

test("dos ítems distintos con la misma fecha no se confunden", () => {
  const items = dedupeItems([
    "- 2026-11 — Viaje a Europa, incluye Ámsterdam (dicho, 2026-09-19).",
    "- 2026-11 — Jess reagenda la cita médica (decidido, 2026-09-10).",
    "- 2026-11 — Viaje a Europa (Ámsterdam y otros destinos por definir) (dicho, 2026-09-21).",
  ]);
  assert.equal(items.length, 2);
  assert.ok(items[1]?.includes("cita médica"));
});
