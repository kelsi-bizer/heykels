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
    description:
      "Create a calendar event and optionally invite guests. For all-day events (school holidays, deadlines) set allDay: true and pass plain dates.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title." },
        start: {
          type: "string",
          description: "ISO 8601 date-time with timezone offset — or YYYY-MM-DD when allDay is true.",
        },
        end: {
          type: "string",
          description:
            "ISO 8601 date-time — or YYYY-MM-DD when allDay is true. For a single all-day date, pass the same date as start.",
        },
        allDay: { type: "boolean", description: "True for date-only events with no time." },
        description: { type: "string" },
        attendees: { type: "array", items: { type: "string" }, description: "Guest email addresses." },
      },
      required: ["summary", "start", "end"],
    },
    requiresConfirmation: true,
    scopeGroup: "calendar",
    summarize: (a) => `Create “${str(a.summary)}” on ${str(a.start).slice(0, 16)}`,
    async execute(auth, args) {
      const cal = google.calendar({ version: "v3", auth });
      const attendees = Array.isArray(args.attendees)
        ? (args.attendees as unknown[])
            .filter((x): x is string => typeof x === "string")
            .map((email) => ({ email }))
        : undefined;

      // Google models all-day events as {date} with an EXCLUSIVE end date, which no
      // model reliably produces — so "same date in and out" is accepted here and the
      // exclusive end is computed. Passing dateTime for a date (or vice versa) is a
      // 400 from Google, hence the explicit branch.
      const allDay = args.allDay === true || /^\d{4}-\d{2}-\d{2}$/.test(str(args.start));
      let start: { date: string } | { dateTime: string };
      let end: { date: string } | { dateTime: string };
      if (allDay) {
        const s = str(args.start).slice(0, 10);
        const eIn = (str(args.end) || s).slice(0, 10);
        const exclusive = new Date(`${eIn}T00:00:00Z`);
        exclusive.setUTCDate(exclusive.getUTCDate() + 1);
        start = { date: s };
        end = { date: exclusive.toISOString().slice(0, 10) };
      } else {
        start = { dateTime: str(args.start) };
        end = { dateTime: str(args.end) };
      }

      const res = await cal.events.insert({
        calendarId: "primary",
        sendUpdates: attendees?.length ? "all" : "none",
        requestBody: {
          summary: str(args.summary),
          description: str(args.description) || undefined,
          start,
          end,
          attendees,
        },
      });
      return { eventId: res.data.id, htmlLink: res.data.htmlLink, status: "created" };
    },
  },
];
