import { NextRequest } from "next/server";
import { readPublicNote } from "@/lib/brain";

export const runtime = "nodejs";

/** A single public note's full body, for the second-brain reader view.
 *  `?path=` is required; anything not public 404s (the API enforces scope,
 *  this is just a defense-in-depth double-check — see lib/brain.ts). */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return new Response(JSON.stringify({ error: "Missing ?path" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const note = await readPublicNote(path);
  if (!note) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  return new Response(JSON.stringify({ note }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
