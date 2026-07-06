import { NextRequest } from "next/server";
import { readPublicNote } from "@/lib/brain";
import { translateNoteBody, translateTexts, type NoteLang } from "@/lib/translate";

export const runtime = "nodejs";

function normalizeLang(raw: string | null): NoteLang | null {
  return raw === "es" || raw === "en" ? raw : null;
}

/** A single public note's full body, for the second-brain reader view.
 *  `?path=` is required; anything not public 404s (the API enforces scope,
 *  this is just a defense-in-depth double-check — see lib/brain.ts).
 *
 *  `?lang=en|es` additionally translates the title + body into that
 *  language (cached per note+language — see lib/translate.ts), so the
 *  reading pane always matches the visitor's chosen language, not whatever
 *  language the note happens to be written in. */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return json(400, { error: "Missing ?path" });
  }
  const note = await readPublicNote(path);
  if (!note) {
    return json(404, { error: "Not found" });
  }

  const lang = normalizeLang(req.nextUrl.searchParams.get("lang"));
  if (!lang) {
    return json(200, { note });
  }

  const [[title], body] = await Promise.all([
    translateTexts(lang, [note.title]),
    translateNoteBody(note.path, note.updated, lang, note.body),
  ]);
  return json(200, { note: { ...note, title: title || note.title, body: body || note.body } });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
