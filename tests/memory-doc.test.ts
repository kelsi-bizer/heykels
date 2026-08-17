import { describe, expect, it } from "vitest";
import {
  mergeMemoryDocs,
  parseMemoryDoc,
  plainSection,
  sectionBullets,
  serializeMemoryDoc,
  setSection,
  filenameToPath,
  pathToFilename,
} from "@/lib/memory/doc";
import { buildDocument, normalizePath } from "@/lib/memory/writer";

const SAMPLE = `---
id: interests/ai-search
title: AI search & agent tooling
tags: [ai, search]
updated: 2026-08-16T12:00:00Z
confidence: 0.8
---
## Summary
Tracking AI-native search products.

## Facts
- Compares products on memory persistence
- Prefers concise technical answers

## Open questions
- Team size?
`;

describe("memory documents", () => {
  it("round-trips through parse and serialize", () => {
    const doc = parseMemoryDoc(SAMPLE);
    expect(doc.frontmatter.id).toBe("interests/ai-search");
    expect(doc.frontmatter.tags).toEqual(["ai", "search"]);
    expect(doc.frontmatter.confidence).toBe(0.8);

    const again = parseMemoryDoc(serializeMemoryDoc(doc));
    expect(again.frontmatter.id).toBe(doc.frontmatter.id);
    expect(again.frontmatter.tags).toEqual(doc.frontmatter.tags);
    expect(sectionBullets(again.body, "Facts")).toEqual(sectionBullets(doc.body, "Facts"));
  });

  it("survives a document a user hand-edited into shape", () => {
    // No frontmatter at all — someone created the file themselves in Drive.
    const doc = parseMemoryDoc("## Facts\n- I like short answers\n", "profile/basics");
    expect(doc.frontmatter.id).toBe("profile/basics");
    expect(doc.frontmatter.tags).toEqual([]);
    expect(sectionBullets(doc.body, "Facts")).toEqual(["I like short answers"]);
  });

  it("reads and replaces sections", () => {
    const doc = parseMemoryDoc(SAMPLE);
    expect(sectionBullets(doc.body, "Facts")).toHaveLength(2);
    expect(plainSection(doc.body, "Summary")).toContain("Tracking AI-native");

    const updated = setSection(doc.body, "Facts", ["only this"]);
    expect(sectionBullets(updated, "Facts")).toEqual(["only this"]);
    // Replacing one section must leave the others intact.
    expect(sectionBullets(updated, "Open questions")).toEqual(["Team size?"]);
  });

  describe("merge", () => {
    it("unions facts instead of replacing them", () => {
      const existing = parseMemoryDoc(SAMPLE);
      const incoming = parseMemoryDoc(`---
id: interests/ai-search
title: AI search & agent tooling
tags: [agents]
updated: 2026-08-17T09:00:00Z
confidence: 0.6
---
## Facts
- Building HeyKels
`);
      const merged = mergeMemoryDocs(existing, incoming);
      const facts = sectionBullets(merged.body, "Facts");

      // The whole point: a second search must not discard what the first learned.
      expect(facts).toContain("Compares products on memory persistence");
      expect(facts).toContain("Building HeyKels");
      expect(merged.frontmatter.tags).toEqual(["ai", "search", "agents"]);
      // Confidence is the max, not the newest.
      expect(merged.frontmatter.confidence).toBe(0.8);
    });

    it("does not duplicate a fact restated with different casing or spacing", () => {
      const existing = parseMemoryDoc(SAMPLE);
      const incoming = parseMemoryDoc(
        `---\nid: x\ntitle: x\n---\n## Facts\n- prefers   CONCISE technical answers\n`,
      );
      const facts = sectionBullets(mergeMemoryDocs(existing, incoming).body, "Facts");
      expect(facts.filter((f) => /concise/i.test(f))).toHaveLength(1);
    });

    it("lets a newer summary replace the old prose", () => {
      const existing = parseMemoryDoc(SAMPLE);
      const incoming = parseMemoryDoc(
        `---\nid: x\ntitle: x\n---\n## Summary\nNow focused on shipping.\n`,
      );
      expect(plainSection(mergeMemoryDocs(existing, incoming).body, "Summary")).toBe(
        "Now focused on shipping.",
      );
    });
  });

  it("maps nested paths to flat Drive filenames and back", () => {
    expect(pathToFilename("interests/ai-search")).toBe("interests__ai-search.md");
    expect(filenameToPath("interests__ai-search.md")).toBe("interests/ai-search.md");
  });
});

describe("normalizePath", () => {
  it("normalizes what a model is likely to produce", () => {
    expect(normalizePath("Interests/AI Search")).toBe("interests/ai-search.md");
    expect(normalizePath("profile/basics.md")).toBe("profile/basics.md");
  });

  it("refuses traversal and absurd nesting", () => {
    // A model-chosen path must never be able to escape the memory folder.
    expect(normalizePath("../../etc/passwd")).toBeNull();
    expect(normalizePath("a/b/c/d/e")).toBeNull();
    expect(normalizePath("   ")).toBeNull();
  });
});

describe("buildDocument", () => {
  it("renders the sections the writer produced", () => {
    const doc = buildDocument("projects/heykels.md", {
      path: "projects/heykels.md",
      title: "HeyKels",
      tags: ["project"],
      summary: "An AI-native search engine.",
      facts: ["Uses gemini-3.5-flash", "Memory lives in Drive"],
      openQuestions: ["Launch date?"],
    });
    expect(plainSection(doc.body, "Summary")).toBe("An AI-native search engine.");
    expect(sectionBullets(doc.body, "Facts")).toHaveLength(2);
    expect(sectionBullets(doc.body, "Open questions")).toEqual(["Launch date?"]);
    expect(doc.frontmatter.id).toBe("projects/heykels");
  });
});
