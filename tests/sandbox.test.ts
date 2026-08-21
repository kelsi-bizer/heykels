import { describe, expect, it } from "vitest";
import {
  buildSandbox,
  isEmpty,
  renderSandbox,
  sandboxSources,
  type DocumentLeg,
  type MemoryLeg,
  type WebLeg,
} from "@/lib/pipeline/sandbox";

const web: WebLeg = {
  ok: true,
  summary: "Grounded findings about AI search.",
  sources: [
    { title: "Google AI docs", url: "https://ai.google.dev/x" },
    { title: "The Verge", url: "https://theverge.com/y" },
  ],
};

const memory: MemoryLeg = {
  ok: true,
  relevantFacts: ["Builds HeyKels", "Based in Austin"],
  preferences: ["Wants concise answers"],
  citedDocPaths: ["projects/heykels.md"],
  gaps: [],
};

const skipped: MemoryLeg = { ok: false, reason: "no memory documents yet", kind: "skipped" };
const failed: WebLeg = { ok: false, reason: "429 RESOURCE_EXHAUSTED", kind: "degraded" };

describe("sandbox", () => {
  it("is only empty when both legs are unusable", () => {
    expect(isEmpty(buildSandbox("q", web, memory))).toBe(false);
    // The single most common real state: connected user, nothing remembered yet.
    expect(isEmpty(buildSandbox("q", web, skipped))).toBe(false);
    expect(isEmpty(buildSandbox("q", failed, memory))).toBe(false);
    expect(isEmpty(buildSandbox("q", failed, skipped))).toBe(true);
  });

  it("takes citations only from the web leg", () => {
    expect(sandboxSources(buildSandbox("q", web, memory))).toHaveLength(2);
    expect(sandboxSources(buildSandbox("q", failed, memory))).toEqual([]);
  });

  describe("prompt rendering", () => {
    it("numbers sources so the model cannot renumber them", () => {
      const text = renderSandbox(buildSandbox("what's new?", web, memory));
      expect(text).toContain("[1] Google AI docs — https://ai.google.dev/x");
      expect(text).toContain("[2] The Verge — https://theverge.com/y");
      expect(text).toContain("use these exact numbers");
    });

    it("presents personal context as already known, never as a document", () => {
      const text = renderSandbox(buildSandbox("q", web, memory));
      expect(text).toContain("What you already know about this user");
      expect(text).toContain("Builds HeyKels");
      // If the prompt frames it as retrieval, the answer narrates "according to
      // your memory…" and the single-assistant illusion breaks.
      expect(text).not.toMatch(/memory document|retrieved|leg B/i);
    });

    it("tells the model to admit it could not check sources when the web leg failed", () => {
      const text = renderSandbox(buildSandbox("q", failed, memory));
      expect(text).toContain("unavailable");
      expect(text).toContain("could not check live sources");
    });

    it("distinguishes an empty corpus from a broken one", () => {
      expect(renderSandbox(buildSandbox("q", web, skipped))).toContain(
        "no stored context about this user yet",
      );
      expect(
        renderSandbox(
          buildSandbox("q", web, { ok: false, reason: "boom", kind: "degraded" }),
        ),
      ).toContain("Personal context: unavailable");
    });
  });

  describe("document turns", () => {
    const doc: DocumentLeg = {
      ok: true,
      title: "Lincoln Elementary 2026–27 (Ava)",
      kind: "calendar",
      markdown: "## August\n- Aug 25 First day of school",
      events: [
        { title: "First day of school", date: "2026-08-25", description: "Ava" },
        { title: "Fall break", date: "2026-10-12", endDate: "2026-10-13" },
      ],
    };
    const webSkipped: WebLeg = { ok: false, reason: "photo attached", kind: "skipped" };

    it("keeps a photo turn non-empty even though the web leg is skipped", () => {
      expect(isEmpty(buildSandbox("q", webSkipped, skipped, doc))).toBe(false);
      expect(
        isEmpty(
          buildSandbox("q", webSkipped, skipped, { ok: false, reason: "blurry", kind: "degraded" }),
        ),
      ).toBe(true);
    });

    it("renders the transcription and instructs a full batch of calendar proposals", () => {
      const text = renderSandbox(buildSandbox("add these", webSkipped, skipped, doc));
      expect(text).toContain("Lincoln Elementary");
      expect(text).toContain("First day of school · 2026-08-25");
      expect(text).toContain("Fall break · 2026-10-12 → 2026-10-13");
      expect(text).toContain("calendar_create_event");
      expect(text).toContain("do not ask first");
      // A deliberately skipped web leg must not make the answer apologise about
      // being unable to check live sources.
      expect(text).not.toContain("could not check live sources");
    });

    it("says plainly when the photo could not be read", () => {
      const text = renderSandbox(
        buildSandbox("q", webSkipped, skipped, { ok: false, reason: "too blurry", kind: "degraded" }),
      );
      expect(text).toContain("could not be read (too blurry)");
    });
  });
});
