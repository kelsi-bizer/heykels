import { describe, expect, it } from "vitest";
import { parseDocumentResult } from "@/lib/pipeline/document-leg";

const asInteraction = (text: string) => ({ steps: [{ content: [{ text }] }] });

describe("document intake parsing", () => {
  it("parses a structured transcription with events", () => {
    const out = parseDocumentResult(
      asInteraction(
        JSON.stringify({
          title: "School calendar (Mia)",
          kind: "calendar",
          markdown: "## Dates\n- Sep 1 Labor Day — no school",
          events: [
            { title: "Labor Day — no school", date: "2026-09-01" },
            { title: "Parent night", date: "2026-09-10", startTime: "18:00", endTime: "19:30" },
          ],
        }),
      ),
    );
    expect(out.kind).toBe("calendar");
    expect(out.events).toHaveLength(2);
    expect(out.events[1].startTime).toBe("18:00");
  });

  it("strips a markdown fence around the JSON", () => {
    const payload = { title: "t", kind: "note", markdown: "hello", events: [] };
    const out = parseDocumentResult(asInteraction("```json\n" + JSON.stringify(payload) + "\n```"));
    expect(out.markdown).toBe("hello");
  });

  it("drops events with malformed dates instead of poisoning the batch", () => {
    const out = parseDocumentResult(
      asInteraction(
        JSON.stringify({
          title: "t",
          kind: "calendar",
          markdown: "m",
          events: [
            { title: "good", date: "2026-09-01" },
            { title: "bad", date: "Sept 1st" },
            { date: "2026-09-02" }, // no title
          ],
        }),
      ),
    );
    expect(out.events).toEqual([{ title: "good", date: "2026-09-01" }]);
  });

  it("keeps the raw text as transcription when JSON parsing fails", () => {
    const out = parseDocumentResult(asInteraction("just plain text, no JSON"));
    expect(out.markdown).toBe("just plain text, no JSON");
    expect(out.events).toEqual([]);
  });
});
