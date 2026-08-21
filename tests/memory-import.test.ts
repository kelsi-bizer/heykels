import { describe, expect, it } from "vitest";
import { chunkTranscripts, extractTranscripts } from "@/lib/memory/import";

describe("export parsing", () => {
  it("extracts only user-authored text from a ChatGPT export", () => {
    const out = extractTranscripts([
      {
        title: "Trip planning",
        update_time: 1_750_000_000,
        mapping: {
          a: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["I have two kids at Lincoln Elementary"] } } },
          b: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["How lovely!"] } } },
          c: { message: null },
        },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Trip planning");
    expect(out[0].userText).toContain("Lincoln Elementary");
    expect(out[0].userText).not.toContain("How lovely");
  });

  it("extracts only human turns from a Claude export", () => {
    const out = extractTranscripts([
      {
        name: "Recipe help",
        updated_at: "2026-05-01T00:00:00Z",
        chat_messages: [
          { sender: "human", text: "I run bizer.ai with my cofounder" },
          { sender: "assistant", text: "Great context!" },
          { sender: "human", content: [{ type: "text", text: "we use Postgres" }] },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].userText).toContain("bizer.ai");
    expect(out[0].userText).toContain("Postgres");
    expect(out[0].userText).not.toContain("Great context");
  });

  it("returns nothing for shapes it does not recognise", () => {
    expect(extractTranscripts({ not: "an array" })).toEqual([]);
    expect(extractTranscripts([{ some: "object" }])).toEqual([]);
    expect(extractTranscripts([{ mapping: { a: { message: { author: { role: "assistant" }, content: { parts: ["x"] } } } } }])).toEqual([]);
  });
});

describe("chunking", () => {
  const t = (title: string, when: number, size: number) => ({
    title,
    when,
    userText: "x".repeat(size),
  });

  it("keeps the newest conversations when the budget runs out", () => {
    const { chunks, used, total } = chunkTranscripts(
      [t("old", 1, 15_000), t("new", 3, 15_000), t("mid", 2, 15_000)],
      { chunkChars: 20_000, maxChunks: 1 },
    );
    expect(total).toBe(3);
    expect(used).toBeLessThan(total);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("Conversation: new");
    expect(chunks[0]).not.toContain("Conversation: old");
  });

  it("packs small conversations together", () => {
    const { chunks, used } = chunkTranscripts(
      [t("a", 3, 4_000), t("b", 2, 4_000), t("c", 1, 4_000)],
      { chunkChars: 20_000, maxChunks: 12 },
    );
    expect(chunks).toHaveLength(1);
    expect(used).toBe(3);
    expect(chunks[0]).toContain("Conversation: a");
    expect(chunks[0]).toContain("Conversation: c");
  });

  it("truncates a single oversized conversation instead of dropping it", () => {
    const { chunks } = chunkTranscripts([t("huge", 1, 100_000)], {
      chunkChars: 20_000,
      maxChunks: 12,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBeLessThanOrEqual(21_000);
  });
});
