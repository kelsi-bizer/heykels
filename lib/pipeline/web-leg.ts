import { MODELS, genai, withRetry } from "./client";
import type { SourceRef } from "./events";
import type { WebLeg } from "./sandbox";

const INSTRUCTION = `You are the web research stage of a search engine.

Search the web and write a dense, factual briefing that answers the user's question.
Prefer recent, specific, verifiable claims. No preamble, no "I searched for" narration,
no closing summary — just the findings. Do not write a bulleted list of links.`;

/**
 * Leg A: web-grounded retrieval.
 *
 * Returns free text, NOT structured JSON. This is deliberate and load-bearing:
 * Gemini's url_citation annotations carry startIndex/endIndex offsets into the model's
 * text output. Forcing response_format to application/json makes those offsets index
 * into a serialized JSON string, so every citation silently points at the wrong span.
 * Sources are therefore read from the annotations — which are authoritative grounding
 * metadata — rather than from anything the model writes about its own sources.
 */
export async function runWebLeg(
  query: string,
  { signal, onLine }: { signal?: AbortSignal; onLine?: (line: string) => void } = {},
): Promise<WebLeg> {
  try {
    onLine?.("querying google_search…");

    const res = await withRetry(
      () =>
        genai().interactions.create({
          model: MODELS.web(),
          input: query,
          system_instruction: INSTRUCTION,
          tools: [{ type: "google_search" }, { type: "url_context" }],
          store: true,
        }),
      { signal },
    );

    const { text, sources } = extractTextAndCitations(res);

    if (sources.length) onLine?.(`${sources.length} sources grounded`);
    onLine?.(text ? "✓ grounded" : "✓ no web results");

    return { ok: true, summary: text, sources };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    const reason = (err as Error)?.message ?? "web search failed";
    onLine?.("✗ failed");
    return { ok: false, reason, kind: "degraded" };
  }
}

interface AnnotationLike {
  type?: string;
  url?: string;
  title?: string;
}
interface ContentLike {
  type?: string;
  text?: string;
  annotations?: AnnotationLike[];
}
interface StepLike {
  type?: string;
  content?: ContentLike[];
  text?: string;
}

/**
 * Pulls the answer text and its citations out of an interaction response.
 *
 * The response is a list of steps (renamed from `outputs`), each holding content
 * blocks; url_citation annotations hang off the text blocks. Written defensively
 * because the exact nesting has moved between SDK releases and a shape change here
 * should degrade to "no citations" rather than throw.
 */
export function extractTextAndCitations(res: unknown): { text: string; sources: SourceRef[] } {
  const r = res as { steps?: StepLike[]; output_text?: string };
  const chunks: string[] = [];
  const seen = new Set<string>();
  const sources: SourceRef[] = [];

  for (const step of r?.steps ?? []) {
    for (const c of step.content ?? []) {
      if (typeof c.text === "string" && c.text) chunks.push(c.text);
      for (const a of c.annotations ?? []) {
        if (a.type !== "url_citation" || !a.url || seen.has(a.url)) continue;
        seen.add(a.url);
        sources.push({ url: a.url, title: a.title || hostOf(a.url) });
      }
    }
    if (!step.content && typeof step.text === "string" && step.text) chunks.push(step.text);
  }

  const text = chunks.join("\n").trim() || (r?.output_text ?? "").trim();
  return { text, sources };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
