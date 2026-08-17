import { GoogleGenAI } from "@google/genai";

/**
 * REQUIREMENT 1 — Gemini 3.5 or newer, reachable through either the Gemini API or
 * Vertex AI. Both are the same GenAI SDK surface, so the pipeline code is identical
 * and only this constructor differs.
 *
 * REQUIREMENT 2 — the Google GenAI SDK is the agent framework the whole pipeline is
 * built on: Interactions API, function calling, streaming and multi-turn tool loops.
 */
export const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";

let cached: GoogleGenAI | null = null;

export function genai(): GoogleGenAI {
  if (cached) return cached;

  if (useVertex) {
    // Vertex AI authenticates with Application Default Credentials — on Cloud Run
    // that is the service account, with no API key anywhere in the environment.
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      throw new Error("GOOGLE_GENAI_USE_VERTEXAI=true requires GOOGLE_CLOUD_PROJECT.");
    }
    cached = new GoogleGenAI({
      vertexai: true,
      project,
      location: process.env.GOOGLE_CLOUD_LOCATION || "global",
    });
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set (or set GOOGLE_GENAI_USE_VERTEXAI=true).");
    }
    cached = new GoogleGenAI({ apiKey });
  }
  return cached;
}

export const MODELS = {
  web: () => process.env.GEMINI_MODEL_WEB || "gemini-3.5-flash",
  memory: () => process.env.GEMINI_MODEL_MEMORY || "gemini-3.5-flash",
  synth: () => process.env.GEMINI_MODEL_SYNTH || "gemini-3.5-flash",
  writer: () => process.env.GEMINI_MODEL_WRITER || "gemini-3.5-flash",
};

function isRateLimit(err: unknown): boolean {
  const s = String((err as { message?: string })?.message ?? err);
  return s.includes("429") || s.includes("RESOURCE_EXHAUSTED");
}

/**
 * Bounded retry for rate limits.
 *
 * Every turn spends 3–4 requests against a *per-project* quota (extra API keys do
 * not raise it), and the two legs fire simultaneously — so brushing the limit is
 * routine rather than exceptional, and a bare failure would lose a good answer.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseMs = 600, signal }: { attempts?: number; baseMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimit(err) || i === attempts - 1) throw err;
      const wait = baseMs * 2 ** i + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
