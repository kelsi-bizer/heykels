import { MODELS, genai, withRetry } from "./client";
import type { DocumentLeg } from "./sandbox";

const INSTRUCTION = `You are the document-intake stage of a search engine. The user photographed
a physical document — often a school calendar, a flyer, a form, or a note.

Transcribe it faithfully into clean markdown. Keep every date, name, time and
instruction; fix obvious OCR-style garbling; do not invent content that is not
on the page.

If the document contains dated events (a calendar, a schedule, a list of dates),
extract each one. Resolve partial dates using the school-year convention: a
month without a year belongs to the academic year the document covers, never the
past. If the document names whose schedule it is (a child, a class, a school),
put that in the title and event descriptions.`;

const SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Short title for the document, e.g. 'Lincoln Elementary 2026–27 calendar (Ava)'.",
    },
    kind: {
      type: "string",
      enum: ["calendar", "schedule", "note", "form", "other"],
      description: "What the document is.",
    },
    markdown: {
      type: "string",
      description: "Faithful markdown transcription of the whole document.",
    },
    events: {
      type: "array",
      description: "Dated events found in the document. Empty when it has none.",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD, for multi-day ranges. Omit for single days." },
          startTime: { type: "string", description: "HH:MM 24h, only when the document gives a time." },
          endTime: { type: "string", description: "HH:MM 24h, only when the document gives a time." },
          description: { type: "string", description: "Detail worth keeping, incl. whose schedule this is." },
        },
        required: ["title", "date"],
      },
    },
  },
  required: ["title", "kind", "markdown", "events"],
} as const;

/**
 * Document intake: runs in place of the web leg when the turn carries a photo.
 *
 * One vision call transcribes and structures the page. The transcription joins the
 * sandbox (so synthesis can answer about it and the memory writer can keep it), and
 * the extracted events let synthesis propose calendar entries — which still go
 * through the user-approval card like every other write.
 */
export async function runDocumentLeg(
  query: string,
  image: { data: string; mime: string },
  { signal, onLine }: { signal?: AbortSignal; onLine?: (line: string) => void } = {},
): Promise<DocumentLeg> {
  try {
    onLine?.("reading the photo…");

    const res = await withRetry(
      () =>
        genai().interactions.create({
          model: MODELS.web(),
          input: [
            { type: "image", data: image.data, mime_type: image.mime },
            {
              type: "text",
              text: query
                ? `The user said, alongside this photo:\n${query}\n\nToday's date: ${new Date().toISOString().slice(0, 10)}`
                : `Today's date: ${new Date().toISOString().slice(0, 10)}`,
            },
          ],
          system_instruction: INSTRUCTION,
          response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
          store: true,
        } as Parameters<ReturnType<typeof genai>["interactions"]["create"]>[0]),
      { signal },
    );

    const parsed = parseDocumentResult(res);
    onLine?.(`✓ ${parsed.title || "transcribed"}`);
    if (parsed.events.length) onLine?.(`${parsed.events.length} dated events found`);
    return { ok: true, ...parsed };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    const reason = (err as Error)?.message ?? "could not read the photo";
    console.error("[heykels] document leg failed:", reason);
    onLine?.("✗ failed");
    return { ok: false, reason, kind: "degraded" };
  }
}

export interface DocumentEvent {
  title: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  description?: string;
}

export interface DocumentPayload {
  title: string;
  kind: string;
  markdown: string;
  events: DocumentEvent[];
}

export function parseDocumentResult(res: unknown): DocumentPayload {
  const r = res as { steps?: { content?: { text?: string }[] }[]; output_text?: string };
  const text =
    (r?.steps ?? [])
      .flatMap((s) => s.content ?? [])
      .map((c) => c.text ?? "")
      .join("") || r?.output_text || "";

  const empty: DocumentPayload = { title: "", kind: "other", markdown: "", events: [] };
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const obj = JSON.parse(cleaned) as Partial<DocumentPayload>;
    const events = Array.isArray(obj.events)
      ? obj.events
          .filter((e): e is DocumentEvent => Boolean(e && typeof e === "object"))
          .map((e) => ({
            title: str(e.title),
            date: str(e.date),
            endDate: str(e.endDate) || undefined,
            startTime: str(e.startTime) || undefined,
            endTime: str(e.endTime) || undefined,
            description: str(e.description) || undefined,
          }))
          .filter((e) => e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
      : [];
    return {
      title: str(obj.title),
      kind: str(obj.kind) || "other",
      markdown: str(obj.markdown),
      events,
    };
  } catch {
    // A transcription that fails schema parsing still carries the raw text.
    return { ...empty, markdown: text.trim() };
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
