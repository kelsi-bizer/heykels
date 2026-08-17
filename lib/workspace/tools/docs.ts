import { google } from "googleapis";
import type { docs_v1 } from "googleapis";
import type { WorkspaceTool } from "../registry";

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

export const docsTools: WorkspaceTool[] = [
  {
    name: "docs_read_document",
    description: "Read the text of a Google Doc by id.",
    parameters: {
      type: "object",
      properties: { documentId: { type: "string" } },
      required: ["documentId"],
    },
    requiresConfirmation: false,
    scopeGroup: "docs",
    summarize: () => "Read a Google Doc",
    async execute(auth, args) {
      const docs = google.docs({ version: "v1", auth });
      const res = await docs.documents.get({ documentId: str(args.documentId) });
      return { title: res.data.title, content: readBody(res.data.body).slice(0, 50_000) };
    },
  },
  {
    name: "docs_create_document",
    description: "Create a new Google Doc with a title and body text.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string", description: "Plain text content." },
      },
      required: ["title"],
    },
    requiresConfirmation: true,
    scopeGroup: "docs",
    summarize: (a) => `Create the doc “${str(a.title)}”`,
    async execute(auth, args) {
      const docs = google.docs({ version: "v1", auth });
      const created = await docs.documents.create({ requestBody: { title: str(args.title) } });
      const documentId = created.data.documentId!;

      const body = str(args.body);
      if (body) {
        await docs.documents.batchUpdate({
          documentId,
          requestBody: { requests: [{ insertText: { location: { index: 1 }, text: body } }] },
        });
      }
      return {
        documentId,
        link: `https://docs.google.com/document/d/${documentId}/edit`,
        status: "created",
      };
    },
  },
  {
    name: "docs_append_text",
    description: "Append text to the end of an existing Google Doc.",
    parameters: {
      type: "object",
      properties: { documentId: { type: "string" }, text: { type: "string" } },
      required: ["documentId", "text"],
    },
    requiresConfirmation: true,
    scopeGroup: "docs",
    summarize: () => "Append text to a Google Doc",
    async execute(auth, args) {
      const docs = google.docs({ version: "v1", auth });
      const documentId = str(args.documentId);
      const doc = await docs.documents.get({ documentId });

      // endIndex points just past the final newline; inserting there is out of range,
      // so the insertion point is one before it.
      const content = doc.data.body?.content ?? [];
      const end = content[content.length - 1]?.endIndex ?? 1;
      const index = Math.max(1, end - 1);

      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: [{ insertText: { location: { index }, text: str(args.text) } }] },
      });
      return { documentId, status: "appended" };
    },
  },
];

function readBody(body: docs_v1.Schema$Body | undefined): string {
  const out: string[] = [];
  for (const el of body?.content ?? []) {
    for (const run of el.paragraph?.elements ?? []) {
      if (run.textRun?.content) out.push(run.textRun.content);
    }
  }
  return out.join("").trim();
}
