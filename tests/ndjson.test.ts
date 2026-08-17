import { describe, expect, it } from "vitest";
import { NdjsonParser, encodeEvent, type StreamEvent } from "@/lib/pipeline/events";

/**
 * Chunk boundaries are the classic streaming bug: it works in every manual test,
 * where events arrive whole, and corrupts under real network conditions, where a
 * chunk can split a JSON object anywhere.
 */
describe("NdjsonParser", () => {
  const events: StreamEvent[] = [
    { type: "turn_created", turnId: "t1" },
    { type: "stage_start", leg: "web" },
    { type: "text_delta", text: "Hello, " },
    { type: "text_delta", text: "world" },
    { type: "done", turnId: "t1" },
  ];
  const wire = events.map(encodeEvent).join("");

  it("parses whole lines", () => {
    const p = new NdjsonParser();
    expect(p.push(wire)).toEqual(events);
  });

  it("carries a partial line across chunks", () => {
    const p = new NdjsonParser();
    const out: StreamEvent[] = [];
    // One byte at a time: the most hostile chunking possible.
    for (const ch of wire) out.push(...p.push(ch));
    out.push(...p.flush());
    expect(out).toEqual(events);
  });

  it("handles a split in the middle of a JSON object", () => {
    const p = new NdjsonParser();
    const cut = Math.floor(wire.length / 2);
    const a = p.push(wire.slice(0, cut));
    const b = p.push(wire.slice(cut));
    expect([...a, ...b]).toEqual(events);
  });

  it("emits nothing until a line is complete", () => {
    const p = new NdjsonParser();
    expect(p.push('{"type":"done","tur')).toEqual([]);
    expect(p.push('nId":"t1"}\n')).toEqual([{ type: "done", turnId: "t1" }]);
  });

  it("recovers a final event with no trailing newline", () => {
    const p = new NdjsonParser();
    expect(p.push('{"type":"done","turnId":"x"}')).toEqual([]);
    expect(p.flush()).toEqual([{ type: "done", turnId: "x" }]);
  });

  it("drops a malformed line without killing the stream", () => {
    const p = new NdjsonParser();
    const out = p.push('not json\n{"type":"done","turnId":"t2"}\n');
    expect(out).toEqual([{ type: "done", turnId: "t2" }]);
  });

  it("ignores blank lines", () => {
    const p = new NdjsonParser();
    expect(p.push('\n\n{"type":"stage_start","leg":"memory"}\n\n')).toEqual([
      { type: "stage_start", leg: "memory" },
    ]);
  });
});
