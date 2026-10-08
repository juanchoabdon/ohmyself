// La foto viva es un estado ACUMULADO: un día flojo no la borra, un día que
// contradice la actualiza con fecha, y lo que ya pasó baja a "Cerrado
// recientemente" solo. Run with `pnpm --filter @ohmyself/server test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOSED_HEADING,
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

test("una sección que vuelve reemplaza a la anterior: la contradicción gana, con su fecha", () => {
  const update = `## Situación

- Ya no están a distancia: los dos en Roma desde el 3 de octubre (dicho, 2026-10-03: foto en el Coliseo).
- Juandi cerró el tema de la carta a Flimp-Globa: "the job is done" (dicho, 2026-10-05).`;
  const next = nextPicture({ previous: PREVIOUS, identity: "", update, day: "2026-10-05" });
  assert.ok(next.includes("los dos en Roma desde el 3 de octubre"));
  assert.ok(next.includes("(dicho, 2026-10-05)"), "la actualización trae su fecha");
  assert.ok(!next.includes("Están a distancia"), "la versión vieja de la Situación no queda al lado");
  assert.ok(next.includes("### Juandi"), "las otras secciones siguen");
  assert.ok(next.includes("- 2026-11-15 — Juandi planea renunciar"), "el horizonte vigente sigue");
});

test("las claves de sección ignoran tildes, mayúsculas y nivel de encabezado", () => {
  const merged = mergePictureRest(`## Situación\n\n- vieja`, `# situacion\n\n- nueva`);
  assert.ok(merged.includes("- nueva"));
  assert.ok(!merged.includes("- vieja"));
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
  const old = Array.from({ length: MAX_CLOSED_ITEMS }, (_, i) => `- viejo ${i}`).join("\n");
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
