/**
 * The NDJSON wire protocol between the search route and the browser.
 *
 * Deliberately distinct from the Gemini SDK's own SSE events: this is our contract,
 * shaped around what the UI needs to draw (two legs, a merge, an answer, an approval
 * gate), not around how the model happens to emit tokens.
 */

export type LegName = "web" | "memory";
export type LegStatus = "ok" | "degraded" | "skipped";

export interface SourceRef {
  title: string;
  url: string;
  /** Present when the citation came from a memory document rather than the web. */
  memoryPath?: string;
}

export interface ProposedTool {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** Human-readable summary rendered on the confirmation card. */
  summary: string;
}

export type StreamEvent =
  | { type: "turn_created"; turnId: string }
  | { type: "stage_start"; leg: LegName }
  | { type: "stage_line"; leg: LegName; line: string }
  | { type: "stage_done"; leg: LegName; status: LegStatus; detail?: string }
  | { type: "sources"; sources: SourceRef[] }
  | { type: "text_delta"; text: string }
  | { type: "tool_result"; toolName: string; ok: boolean; summary: string }
  | { type: "tool_proposed"; calls: ProposedTool[] }
  | { type: "memory_updated"; paths: string[] }
  | { type: "done"; turnId: string }
  | { type: "error"; message: string };

export function encodeEvent(e: StreamEvent): string {
  return JSON.stringify(e) + "\n";
}

/**
 * Incremental NDJSON parser.
 *
 * A chunk boundary can land anywhere, including mid-token inside a JSON object, so
 * the trailing partial line has to be carried across pushes rather than parsed.
 * Getting this wrong produces a stream that works in testing and corrupts under load.
 */
export class NdjsonParser {
  private buf = "";

  push(chunk: string): StreamEvent[] {
    this.buf += chunk;
    const out: StreamEvent[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as StreamEvent);
      } catch {
        // A malformed line is dropped rather than killing the stream; the `done`
        // event is what the UI treats as authoritative completion.
      }
    }
    return out;
  }

  /** Any complete event left in the buffer when the stream ends without a newline. */
  flush(): StreamEvent[] {
    const rest = this.buf.trim();
    this.buf = "";
    if (!rest) return [];
    try {
      return [JSON.parse(rest) as StreamEvent];
    } catch {
      return [];
    }
  }
}
