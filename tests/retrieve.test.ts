import { describe, expect, it } from "vitest";
import { scoreDoc, tokenize } from "@/lib/memory/retrieve";
import { extractTextAndCitations } from "@/lib/pipeline/web-leg";
import { parseJsonResult } from "@/lib/pipeline/memory-leg";

describe("tokenize", () => {
  it("drops stopwords and short tokens", () => {
    expect(tokenize("What is my HeyKels architecture about?")).toEqual([
      "heykels",
      "architecture",
    ]);
  });
});

describe("scoreDoc", () => {
  const doc = {
    path: "projects/heykels.md",
    title: "HeyKels architecture",
    tags: ["project", "architecture"],
    body: "The pipeline uses two legs. Architecture notes. Architecture again.",
  };

  it("ranks a tag hit above a body-only hit", () => {
    const tagHit = scoreDoc(["project"], doc);
    const bodyHit = scoreDoc(["pipeline"], doc);
    expect(tagHit).toBeGreaterThan(bodyHit);
  });

  it("scores zero when nothing matches", () => {
    expect(scoreDoc(["kubernetes"], doc)).toBe(0);
  });

  it("applies diminishing returns to repetition", () => {
    const once = scoreDoc(["pipeline"], doc);
    const thrice = scoreDoc(["architecture"], doc);
    // "architecture" also hits title and path, so it must win — but repetition alone
    // must not let a keyword-stuffed document dominate.
    expect(thrice).toBeGreaterThan(once);
    expect(thrice).toBeLessThan(once * 12);
  });
});

describe("extractTextAndCitations", () => {
  it("reads text and url_citation annotations out of steps", () => {
    const res = {
      steps: [
        {
          content: [
            {
              type: "text",
              text: "AI search changed this year.",
              annotations: [
                { type: "url_citation", url: "https://example.com/a", title: "Example A" },
                { type: "url_citation", url: "https://example.com/b", title: "Example B" },
              ],
            },
          ],
        },
      ],
    };
    const { text, sources } = extractTextAndCitations(res);
    expect(text).toBe("AI search changed this year.");
    expect(sources).toEqual([
      { url: "https://example.com/a", title: "Example A" },
      { url: "https://example.com/b", title: "Example B" },
    ]);
  });

  it("deduplicates repeated citations of the same url", () => {
    const res = {
      steps: [
        {
          content: [
            {
              text: "x",
              annotations: [
                { type: "url_citation", url: "https://a.com/1", title: "A" },
                { type: "url_citation", url: "https://a.com/1", title: "A" },
              ],
            },
          ],
        },
      ],
    };
    expect(extractTextAndCitations(res).sources).toHaveLength(1);
  });

  it("falls back to a hostname when a citation has no title", () => {
    const res = {
      steps: [{ content: [{ text: "x", annotations: [{ type: "url_citation", url: "https://www.bbc.co.uk/n" }] }] }],
    };
    expect(extractTextAndCitations(res).sources[0].title).toBe("bbc.co.uk");
  });

  it("degrades to empty rather than throwing on an unexpected shape", () => {
    // The response nesting has moved between SDK releases; a shape change should
    // cost citations, not the whole answer.
    expect(extractTextAndCitations({})).toEqual({ text: "", sources: [] });
    expect(extractTextAndCitations(null)).toEqual({ text: "", sources: [] });
    expect(extractTextAndCitations({ steps: [{ text: "plain" }] }).text).toBe("plain");
  });
});

describe("parseJsonResult", () => {
  const payload = {
    relevantFacts: ["a"],
    preferences: ["b"],
    citedDocPaths: ["p.md"],
    gaps: [],
  };

  it("parses structured output", () => {
    const res = { steps: [{ content: [{ text: JSON.stringify(payload) }] }] };
    expect(parseJsonResult(res)).toEqual(payload);
  });

  it("tolerates a fenced code block", () => {
    const res = { steps: [{ content: [{ text: "```json\n" + JSON.stringify(payload) + "\n```" }] }] };
    expect(parseJsonResult(res)).toEqual(payload);
  });

  it("returns empty arrays on unparseable output", () => {
    expect(parseJsonResult({ steps: [{ content: [{ text: "sorry!" }] }] })).toEqual({
      relevantFacts: [],
      preferences: [],
      citedDocPaths: [],
      gaps: [],
    });
  });

  it("filters non-string entries", () => {
    const res = {
      steps: [{ content: [{ text: JSON.stringify({ ...payload, relevantFacts: ["ok", 42, null] }) }] }],
    };
    expect(parseJsonResult(res).relevantFacts).toEqual(["ok"]);
  });
});
