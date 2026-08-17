import { google } from "googleapis";
import type { WorkspaceTool } from "../registry";

const gmailFor = (auth: Parameters<typeof google.gmail>[0]["auth"]) =>
  google.gmail({ version: "v1", auth });

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** RFC 2822 message, base64url encoded as the Gmail API expects. */
function buildRaw({ to, subject, body, cc }: { to: string; subject: string; body: string; cc?: string }) {
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : "",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ].filter(Boolean);
  const message = `${headers.join("\r\n")}\r\n\r\n${body}`;
  return Buffer.from(message).toString("base64url");
}

function headerValue(headers: { name?: string | null; value?: string | null }[], name: string) {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export const gmailTools: WorkspaceTool[] = [
  {
    name: "gmail_search_messages",
    description:
      "Search the user's Gmail using Gmail query syntax (e.g. 'from:dana newer_than:7d'). Returns message ids, senders, subjects and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query." },
        maxResults: { type: "number", description: "How many messages to return (default 10, max 25)." },
      },
      required: ["query"],
    },
    requiresConfirmation: false,
    scopeGroup: "gmail",
    summarize: (a) => `Search mail for “${str(a.query)}”`,
    async execute(auth, args) {
      const gmail = gmailFor(auth);
      const max = Math.min(Number(args.maxResults ?? 10) || 10, 25);
      const list = await gmail.users.messages.list({
        userId: "me",
        q: str(args.query),
        maxResults: max,
      });
      const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
      const messages = await Promise.all(
        ids.map(async (id) => {
          const m = await gmail.users.messages.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Date"],
          });
          const headers = m.data.payload?.headers ?? [];
          return {
            id,
            from: headerValue(headers, "From"),
            subject: headerValue(headers, "Subject"),
            date: headerValue(headers, "Date"),
            snippet: m.data.snippet ?? "",
          };
        }),
      );
      return { messages };
    },
  },
  {
    name: "gmail_read_message",
    description: "Read the full plain-text body of one Gmail message by id.",
    parameters: {
      type: "object",
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    },
    requiresConfirmation: false,
    scopeGroup: "gmail",
    summarize: () => "Read a mail message",
    async execute(auth, args) {
      const gmail = gmailFor(auth);
      const m = await gmail.users.messages.get({
        userId: "me",
        id: str(args.messageId),
        format: "full",
      });
      const headers = m.data.payload?.headers ?? [];
      return {
        from: headerValue(headers, "From"),
        subject: headerValue(headers, "Subject"),
        date: headerValue(headers, "Date"),
        body: extractPlainText(m.data.payload).slice(0, 20_000),
      };
    },
  },
  {
    name: "gmail_create_draft",
    description:
      "Create a Gmail draft. Nothing is sent. Prefer this over sending unless the user explicitly asked to send.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Comma-separated recipients." },
        cc: { type: "string" },
        subject: { type: "string" },
        body: { type: "string", description: "Plain-text body." },
      },
      required: ["to", "subject", "body"],
    },
    requiresConfirmation: true,
    scopeGroup: "gmail",
    summarize: (a) => `Draft “${str(a.subject)}” to ${str(a.to)}`,
    async execute(auth, args) {
      const gmail = gmailFor(auth);
      const res = await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
          message: {
            raw: buildRaw({
              to: str(args.to),
              cc: str(args.cc) || undefined,
              subject: str(args.subject),
              body: str(args.body),
            }),
          },
        },
      });
      return { draftId: res.data.id, status: "draft created; nothing was sent" };
    },
  },
  {
    name: "gmail_send_message",
    description: "Send an email immediately. Only use when the user clearly asked to send, not draft.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        cc: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
    requiresConfirmation: true,
    scopeGroup: "gmail",
    summarize: (a) => `Send “${str(a.subject)}” to ${str(a.to)}`,
    async execute(auth, args) {
      const gmail = gmailFor(auth);
      const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: buildRaw({
            to: str(args.to),
            cc: str(args.cc) || undefined,
            subject: str(args.subject),
            body: str(args.body),
          }),
        },
      });
      return { messageId: res.data.id, status: "sent" };
    },
  },
];

interface PayloadPart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: PayloadPart[];
}

/** Walks the MIME tree for text/plain, falling back to stripped HTML. */
function extractPlainText(payload: PayloadPart | undefined | null): string {
  if (!payload) return "";
  const decode = (d?: string | null) => (d ? Buffer.from(d, "base64url").toString("utf8") : "");

  if (payload.mimeType === "text/plain" && payload.body?.data) return decode(payload.body.data);

  for (const part of payload.parts ?? []) {
    const text = extractPlainText(part);
    if (text) return text;
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decode(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}
