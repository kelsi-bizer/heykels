import { google } from "googleapis";
import type { WorkspaceTool } from "../registry";
import { MEMORY_APP_PROPERTY } from "@/lib/memory/drive-store";

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Google-native types have no bytes to download; they must be exported. */
const EXPORT_AS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const READABLE = /^(text\/|application\/(json|xml|rtf|x-yaml))/;
const MAX_BYTES = 100_000;

export const driveTools: WorkspaceTool[] = [
  {
    name: "drive_search_files",
    description:
      "Search the user's Google Drive by name or full-text content. Returns file ids, names and types.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for in the file name or contents." },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
    requiresConfirmation: false,
    scopeGroup: "drive",
    summarize: (a) => `Search Drive for “${str(a.query)}”`,
    async execute(auth, args) {
      const drive = google.drive({ version: "v3", auth });
      const q = str(args.query).replace(/'/g, "\\'");
      const res = await drive.files.list({
        q: `(name contains '${q}' or fullText contains '${q}') and trashed = false`,
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,appProperties)",
        pageSize: Math.min(Number(args.maxResults ?? 10) || 10, 25),
        orderBy: "modifiedTime desc",
      });

      // Memory documents are excluded deliberately. They already reach the model
      // through the memory leg; surfacing them here too would double-feed the same
      // content and invite the agent to rewrite memory outside the writer path.
      const files = (res.data.files ?? []).filter(
        (f) => f.appProperties?.[MEMORY_APP_PROPERTY.key] !== MEMORY_APP_PROPERTY.value,
      );

      return {
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          link: f.webViewLink,
        })),
      };
    },
  },
  {
    name: "drive_read_file",
    description:
      "Read the text content of a Drive file by id. Handles Google Docs, Sheets and Slides as well as plain text files.",
    parameters: {
      type: "object",
      properties: { fileId: { type: "string" } },
      required: ["fileId"],
    },
    requiresConfirmation: false,
    scopeGroup: "drive",
    summarize: () => "Read a Drive file",
    async execute(auth, args) {
      const drive = google.drive({ version: "v3", auth });
      const fileId = str(args.fileId);

      const meta = await drive.files.get({ fileId, fields: "id,name,mimeType,size" });
      const mimeType = meta.data.mimeType ?? "";

      const exportAs = EXPORT_AS[mimeType];
      if (exportAs) {
        const res = await drive.files.export({ fileId, mimeType: exportAs }, { responseType: "text" });
        return { name: meta.data.name, mimeType, content: truncate(String(res.data)) };
      }

      if (!READABLE.test(mimeType)) {
        return {
          name: meta.data.name,
          mimeType,
          error: `This file is ${mimeType}, which has no text to read.`,
        };
      }

      const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
      return { name: meta.data.name, mimeType, content: truncate(String(res.data)) };
    },
  },
];

/** A large file would otherwise consume the whole context window. */
function truncate(text: string): string {
  if (text.length <= MAX_BYTES) return text;
  return `${text.slice(0, MAX_BYTES)}\n\n…[truncated at ${MAX_BYTES} characters]`;
}
