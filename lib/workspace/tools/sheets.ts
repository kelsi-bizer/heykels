import { google } from "googleapis";
import type { WorkspaceTool } from "../registry";

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Accepts a rectangular array of scalars; anything else is rejected before the API call. */
function toValues(v: unknown): (string | number | boolean)[][] {
  if (!Array.isArray(v)) throw new Error("`values` must be an array of rows.");
  return v.map((row) => {
    if (!Array.isArray(row)) throw new Error("Each row in `values` must itself be an array.");
    return row.map((cell) =>
      typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean"
        ? cell
        : String(cell ?? ""),
    );
  });
}

export const sheetsTools: WorkspaceTool[] = [
  {
    name: "sheets_read_range",
    description: "Read a range from a Google Sheet, e.g. 'Sheet1!A1:D50'.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: { type: "string" },
        range: { type: "string", description: "A1 notation, e.g. 'Sheet1!A1:D50'." },
      },
      required: ["spreadsheetId", "range"],
    },
    requiresConfirmation: false,
    scopeGroup: "sheets",
    summarize: (a) => `Read ${str(a.range)}`,
    async execute(auth, args) {
      const sheets = google.sheets({ version: "v4", auth });
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: str(args.spreadsheetId),
        range: str(args.range),
      });
      return { range: res.data.range, values: res.data.values ?? [] };
    },
  },
  {
    name: "sheets_write_range",
    description: "Write rows into a range of a Google Sheet, overwriting what is there.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: { type: "string" },
        range: { type: "string", description: "A1 notation for the top-left of the write." },
        values: {
          type: "array",
          items: { type: "array", items: {} },
          description: "Rows of cell values.",
        },
      },
      required: ["spreadsheetId", "range", "values"],
    },
    requiresConfirmation: true,
    scopeGroup: "sheets",
    summarize: (a) => `Write to ${str(a.range)}`,
    async execute(auth, args) {
      const sheets = google.sheets({ version: "v4", auth });
      const values = toValues(args.values);
      const res = await sheets.spreadsheets.values.update({
        spreadsheetId: str(args.spreadsheetId),
        range: str(args.range),
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
      return { updatedCells: res.data.updatedCells, status: "written" };
    },
  },
  {
    name: "sheets_create_spreadsheet",
    description: "Create a new Google Sheet, optionally seeded with rows.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        values: { type: "array", items: { type: "array", items: {} } },
      },
      required: ["title"],
    },
    requiresConfirmation: true,
    scopeGroup: "sheets",
    summarize: (a) => `Create the sheet “${str(a.title)}”`,
    async execute(auth, args) {
      const sheets = google.sheets({ version: "v4", auth });
      const created = await sheets.spreadsheets.create({
        requestBody: { properties: { title: str(args.title) } },
      });
      const spreadsheetId = created.data.spreadsheetId!;

      if (args.values) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "A1",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: toValues(args.values) },
        });
      }
      return {
        spreadsheetId,
        link: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        status: "created",
      };
    },
  },
];
