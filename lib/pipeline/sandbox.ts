import type { SourceRef } from "./events";

/**
 * The typed join point where both retrieval legs land before synthesis.
 *
 * Pure and I/O-free on purpose: this is the seam that makes the pipeline testable
 * without a network, and the place where "one leg failed" is represented as data
 * rather than as a thrown exception.
 */

export interface WebLegResult {
  ok: true;
  summary: string;
  sources: SourceRef[];
}

export interface MemoryLegResult {
  ok: true;
  relevantFacts: string[];
  preferences: string[];
  citedDocPaths: string[];
  gaps: string[];
}

export interface LegFailure {
  ok: false;
  reason: string;
  /** `skipped` is a deliberate no-op (empty corpus); `degraded` is a real failure. */
  kind: "skipped" | "degraded";
}

export interface DocumentLegResult {
  ok: true;
  title: string;
  kind: string;
  /** Faithful transcription of the photographed page. */
  markdown: string;
  events: {
    title: string;
    date: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    description?: string;
  }[];
}

export type WebLeg = WebLegResult | LegFailure;
export type MemoryLeg = MemoryLegResult | LegFailure;
export type DocumentLeg = DocumentLegResult | LegFailure;

export interface Sandbox {
  query: string;
  web: WebLeg;
  memory: MemoryLeg;
  /** Present only on turns that carried a photo; replaces the web leg there. */
  document?: DocumentLeg;
}

export function buildSandbox(
  query: string,
  web: WebLeg,
  memory: MemoryLeg,
  document?: DocumentLeg,
): Sandbox {
  return document ? { query, web, memory, document } : { query, web, memory };
}

/** Every leg unusable means there is nothing to synthesize from. */
export function isEmpty(s: Sandbox): boolean {
  return !s.web.ok && !s.memory.ok && !(s.document?.ok ?? false);
}

export function sandboxSources(s: Sandbox): SourceRef[] {
  return s.web.ok ? s.web.sources : [];
}

/**
 * Renders the sandbox as the synthesis prompt.
 *
 * Two rules are load-bearing. First, the personal context is presented as things
 * already known about the user, never as a retrieved document — otherwise the model
 * narrates "according to your memory…" and the illusion of a single assistant breaks.
 * Second, citation numbers are fixed to the web sources array, so the model cannot
 * renumber them and desynchronise the chips from the annotations they came from.
 */
export function renderSandbox(s: Sandbox): string {
  const parts: string[] = [`User's question:\n${s.query}\n`];

  if (s.document) {
    if (s.document.ok) {
      parts.push(
        `The user photographed a document (${s.document.kind}): ${s.document.title}\n` +
          `Transcription:\n${s.document.markdown}\n`,
      );
      if (s.document.events.length) {
        const list = s.document.events
          .map((e) => {
            const when = [
              e.date,
              e.endDate ? `→ ${e.endDate}` : "",
              e.startTime ? `${e.startTime}${e.endTime ? `–${e.endTime}` : ""}` : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `- ${e.title} · ${when}${e.description ? ` · ${e.description}` : ""}`;
          })
          .join("\n");
        parts.push(
          `Dated events extracted from the document:\n${list}\n\n` +
            `If a calendar tool is available, propose calendar_create_event for each of these ` +
            `(allDay: true unless the document gives a time). The user approves or rejects them ` +
            `before anything is created — propose the complete set, do not ask first.\n`,
        );
      }
    } else {
      parts.push(`The user attached a photo, but it could not be read (${s.document.reason}).\n`);
    }
  }

  if (s.web.ok) {
    parts.push(`Web findings (grounded, cite these):\n${s.web.summary}\n`);
    if (s.web.sources.length) {
      const list = s.web.sources
        .map((src, i) => `[${i + 1}] ${src.title} — ${src.url}`)
        .join("\n");
      parts.push(`Numbered sources — use these exact numbers when citing:\n${list}\n`);
    }
  } else if (s.web.kind === "skipped") {
    // Deliberate no-op (e.g. a photo turn) — nothing to apologise for.
  } else {
    parts.push(
      `Web findings: unavailable (${s.web.reason}). Answer from personal context and general knowledge, and say plainly that you could not check live sources.\n`,
    );
  }

  if (s.memory.ok) {
    const facts = s.memory.relevantFacts.map((f) => `- ${f}`).join("\n");
    const prefs = s.memory.preferences.map((p) => `- ${p}`).join("\n");
    parts.push(
      `What you already know about this user:\n${facts || "- (nothing relevant)"}\n`,
    );
    if (prefs) parts.push(`How they like answers written:\n${prefs}\n`);
  } else if (s.memory.kind === "skipped") {
    parts.push(`You have no stored context about this user yet.\n`);
  } else {
    parts.push(`Personal context: unavailable (${s.memory.reason}).\n`);
  }

  return parts.join("\n");
}

export const SYNTHESIS_INSTRUCTION = `You are HeyKels, a search engine that answers as one voice.

You are given web findings and personal context about the user. Merge them into a single
answer. Never mention "memory", "context", "leg", or where a fact came from — the user
knows you know them. Just answer as someone who already has that background.

Rules:
- Cite web claims with the exact bracket numbers given, like [1] or [2]. Never invent a
  number that isn't in the list, and never renumber.
- Prefer specifics over hedging. Lead with the answer, then support it.
- Use short markdown headings only when the answer genuinely has parts.
- If the user's personal context changes what matters, let it shape the answer's emphasis
  rather than adding a paragraph about them.
- If you were unable to check live sources, say so in one clause; do not pad.
- When the input includes a photographed document, summarize what it says in a few lines.
  If dated events were extracted and a calendar tool is available, call
  calendar_create_event for every event in the same response — the user approves the
  batch before anything is written, so never ask "shall I add these?" first. Use
  allDay: true for dates without times.`;
