import { slugify } from "../core/index.js";
import { type Connector, type ConnectorContext, type PullResult, emptyResult } from "./types.js";

export interface CalendarEvent {
  id: string;
  title: string;
  start?: string;
  end?: string;
  attendees?: string[];
  description?: string;
  /** Meeting transcript text, if available from the source. */
  transcript?: string;
}

export interface CalendarPullOptions {
  /** Provide events directly (e.g. from tests or another sync step). */
  events?: CalendarEvent[];
  /** Or fetch from Google with an OAuth access token. */
  accessToken?: string;
  timeMin?: string;
  timeMax?: string;
  /** Where to file transcripts. Default: meetings/<date>-<slug>.md */
  folder?: string;
  visibility?: "public" | "private" | "secret";
}

async function fetchGoogleEvents(opts: CalendarPullOptions): Promise<CalendarEvent[]> {
  const token = opts.accessToken;
  if (!token) {
    throw new Error(
      "Google Calendar connector not configured: pass options.accessToken (OAuth) or options.events. " +
        "Set GOOGLE_CLIENT_ID/SECRET and complete the OAuth flow to obtain a token.",
    );
  }
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  if (opts.timeMin) params.set("timeMin", opts.timeMin);
  if (opts.timeMax) params.set("timeMax", opts.timeMax);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Google Calendar API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { items?: GoogleEvent[] };
  return (data.items ?? []).map(normalizeGoogleEvent);
}

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string }[];
}

function normalizeGoogleEvent(e: GoogleEvent): CalendarEvent {
  return {
    id: e.id,
    title: e.summary ?? "Untitled meeting",
    start: e.start?.dateTime ?? e.start?.date,
    end: e.end?.dateTime ?? e.end?.date,
    attendees: (e.attendees ?? []).map((a) => a.displayName ?? a.email ?? "").filter(Boolean),
    description: e.description,
  };
}

function eventToMarkdown(e: CalendarEvent): string {
  const lines: string[] = [`# ${e.title}`, ""];
  if (e.start) lines.push(`- **When:** ${e.start}${e.end ? ` → ${e.end}` : ""}`);
  if (e.attendees?.length) lines.push(`- **Attendees:** ${e.attendees.join(", ")}`);
  lines.push("");
  if (e.description) lines.push("## Notes", "", e.description, "");
  lines.push("## Transcript", "", e.transcript ?? "_No transcript captured yet._", "");
  return lines.join("\n");
}

/** Pulls calendar meetings and files each as a `transcript` note. */
export const googleCalendarConnector: Connector<CalendarPullOptions> = {
  id: "google-calendar",
  label: "Google Calendar",
  description: "Imports calendar meetings and stores each as a transcript note.",

  async pull(ctx: ConnectorContext, options: CalendarPullOptions = {}): Promise<PullResult> {
    const events = options.events ?? (await fetchGoogleEvents(options));
    const folder = options.folder ?? "meetings";
    const visibility = options.visibility ?? "private";
    const result = emptyResult();

    for (const e of events) {
      const date = (e.start ?? "").slice(0, 10) || "undated";
      const path = `${folder}/${date}-${slugify(e.title)}.md`;
      try {
        // Skip if it already exists (idempotent pulls).
        await ctx.brain.readNote(ctx.userId, path, ctx.allowed);
        result.skipped.push(path);
      } catch {
        await ctx.brain.createNote(
          ctx.userId,
          {
            type: "transcript",
            title: e.title,
            body: eventToMarkdown(e),
            visibility,
            tags: ["meeting", "calendar"],
            path,
          },
          ctx.config,
          ctx.allowed,
        );
        result.created.push(path);
      }
    }
    return result;
  },
};
