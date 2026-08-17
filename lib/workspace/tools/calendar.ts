import { google } from "googleapis";
import type { WorkspaceTool } from "../registry";

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

export const calendarTools: WorkspaceTool[] = [
  {
    name: "calendar_list_events",
    description:
      "List the user's calendar events in a time window. Use this before proposing a meeting time.",
    parameters: {
      type: "object",
      properties: {
        timeMin: { type: "string", description: "ISO 8601 start of window. Defaults to now." },
        timeMax: { type: "string", description: "ISO 8601 end of window. Defaults to 7 days out." },
        maxResults: { type: "number" },
      },
    },
    requiresConfirmation: false,
    scopeGroup: "calendar",
    summarize: () => "Check the calendar",
    async execute(auth, args) {
      const cal = google.calendar({ version: "v3", auth });
      const now = new Date();
      const week = new Date(now.getTime() + 7 * 86_400_000);
      const res = await cal.events.list({
        calendarId: "primary",
        timeMin: str(args.timeMin) || now.toISOString(),
        timeMax: str(args.timeMax) || week.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: Math.min(Number(args.maxResults ?? 25) || 25, 50),
      });
      return {
        events: (res.data.items ?? []).map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          attendees: (e.attendees ?? []).map((a) => a.email).filter(Boolean),
        })),
      };
    },
  },
  {
    name: "calendar_create_event",
    description: "Create a calendar event and optionally invite guests.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title." },
        start: { type: "string", description: "ISO 8601 start, with timezone offset." },
        end: { type: "string", description: "ISO 8601 end, with timezone offset." },
        description: { type: "string" },
        attendees: { type: "array", items: { type: "string" }, description: "Guest email addresses." },
      },
      required: ["summary", "start", "end"],
    },
    requiresConfirmation: true,
    scopeGroup: "calendar",
    summarize: (a) => `Create “${str(a.summary)}” on ${str(a.start)}`,
    async execute(auth, args) {
      const cal = google.calendar({ version: "v3", auth });
      const attendees = Array.isArray(args.attendees)
        ? (args.attendees as unknown[])
            .filter((x): x is string => typeof x === "string")
            .map((email) => ({ email }))
        : undefined;

      const res = await cal.events.insert({
        calendarId: "primary",
        sendUpdates: attendees?.length ? "all" : "none",
        requestBody: {
          summary: str(args.summary),
          description: str(args.description) || undefined,
          start: { dateTime: str(args.start) },
          end: { dateTime: str(args.end) },
          attendees,
        },
      });
      return { eventId: res.data.id, htmlLink: res.data.htmlLink, status: "created" };
    },
  },
];
