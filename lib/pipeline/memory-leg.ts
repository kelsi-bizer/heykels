import { MODELS, genai, withRetry } from "./client";
import type { RetrievedDoc } from "@/lib/memory/retrieve";
import type { MemoryLeg } from "./sandbox";

const INSTRUCTION = `You extract what is already known about a user that bears on their question.

You are given the user's question and excerpts from their own memory documents.
Return only what is genuinely relevant. Do not speculate, do not restate the question,
and do not invent facts that are not in the documents. An empty result is correct and
expected when nothing applies.`;

const SCHEMA = {
  type: "object",
  properties: {
    relevantFacts: {
      type: "array",
      items: { type: "string" },
      description: "Facts about this user that change how the question should be answered.",
    },
    preferences: {
      type: "array",
      items: { type: "string" },
      description: "Stated preferences about how they want answers written.",
    },
    citedDocPaths: {
      type: "array",
      items: { type: "string" },
      description: "Paths of the documents actually used.",
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "Things worth learning about the user to answer this better next time.",
    },
  },
  required: ["relevantFacts", "preferences", "citedDocPaths", "gaps"],
} as const;

/**
 * Leg B: memory-grounded retrieval.
 *
 * Structured JSON is fine here — unlike the web leg there are no citation
 * annotations whose offsets could be broken by serialization.
 */
export async function runMemoryLeg(
  query: string,
  docs: RetrievedDoc[],
  { signal, onLine }: { signal?: AbortSignal; onLine?: (line: string) => void } = {},
): Promise<MemoryLeg> {
  // Short-circuit before spending a request. A new user has no memory, and that is
  // the single most common state — burning a call to be told "nothing" costs latency
  // and quota on exactly the request that can least afford it.
  if (docs.length === 0) {
    onLine?.("retrieve() → 0 docs");
    onLine?.("✓ nothing stored yet");
    return { ok: false, reason: "no memory documents yet", kind: "skipped" };
  }

  onLine?.(`retrieve() → ${docs.length} docs`);
  for (const d of docs.slice(0, 4)) onLine?.(d.path);

  try {
    const corpus = docs
      .map((d) => `--- ${d.path} (${d.tags.join(", ")})\n${d.body}`)
      .join("\n\n");

    const res = await withRetry(
      () =>
        genai().interactions.create({
          model: MODELS.memory(),
          input: `Question:\n${query}\n\nThe user's memory documents:\n${corpus}`,
          system_instruction: INSTRUCTION,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: SCHEMA,
          },
          store: true,
        } as Parameters<ReturnType<typeof genai>["interactions"]["create"]>[0]),
      { signal },
    );

    const parsed = parseJsonResult(res);
    onLine?.(`✓ ${parsed.relevantFacts.length} facts`);
    return { ok: true, ...parsed };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    onLine?.("✗ failed");
    return {
      ok: false,
      reason: (err as Error)?.message ?? "memory search failed",
      kind: "degraded",
    };
  }
}

interface MemoryPayload {
  relevantFacts: string[];
  preferences: string[];
  citedDocPaths: string[];
  gaps: string[];
}

export function parseJsonResult(res: unknown): MemoryPayload {
  const r = res as {
    steps?: { content?: { text?: string }[] }[];
    output_text?: string;
  };
  const text =
    (r?.steps ?? [])
      .flatMap((s) => s.content ?? [])
      .map((c) => c.text ?? "")
      .join("") || r?.output_text || "";

  const empty: MemoryPayload = {
    relevantFacts: [],
    preferences: [],
    citedDocPaths: [],
    gaps: [],
  };

  try {
    // Models occasionally wrap JSON in a fence even under a schema constraint.
    const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const obj = JSON.parse(cleaned) as Partial<MemoryPayload>;
    return {
      relevantFacts: arr(obj.relevantFacts),
      preferences: arr(obj.preferences),
      citedDocPaths: arr(obj.citedDocPaths),
      gaps: arr(obj.gaps),
    };
  } catch {
    return empty;
  }
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
