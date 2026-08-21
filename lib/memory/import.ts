import { MODELS, genai, withRetry } from "@/lib/pipeline/client";
import type { getWorkspaceContext } from "@/lib/google/tokens";
import {
  UPSERT_SCHEMA,
  applyUpsert,
  normalizePath,
  parseUpserts,
} from "./writer";

/**
 * Memory import: turn a ChatGPT or Claude data export (or pasted memory text)
 * into HeyKels memory documents.
 *
 * The load-bearing decision: imports are DISTILLED, never dumped. A data export
 * holds megabytes of conversation, almost all of it worthless as memory. Only the
 * user's own words are read (the assistant's replies say nothing reliable about
 * the person), recent-first, through the same fact-extraction contract the turn
 * writer uses — so imported memory merges with searched memory instead of forming
 * a second system.
 */

const INSTRUCTION = `You distill a user's long-term memory from their own words in past
AI-assistant conversations (or from an exported memory summary they provided).

You are given only what the USER wrote. Extract durable facts about the person —
their projects, work, family, interests, preferences, constraints, and the people
and organizations around them.

Rules:
- Record facts about the person, never facts about the world, and never facts
  about the assistant they were talking to.
- Skip anything transient ("fix this bug", "rewrite that email") unless it reveals
  something durable (what they work on, who with, how they like things done).
- Use short, stable, kebab-case paths grouped by kind: "profile/basics",
  "entities/people", "entities/organizations", "projects/<name>", "interests/<topic>".
- Reuse the SAME path for the same person/project across chunks, so facts merge.
- Each fact must stand alone, without the surrounding conversation.
- An empty result is valid for a chunk with nothing durable in it.`;

export interface Transcript {
  title: string;
  /** Epoch millis when known; imports are processed newest-first. */
  when: number;
  userText: string;
}

/**
 * Pulls user-authored text out of a parsed conversations.json, for both known
 * export shapes: ChatGPT (mapping graph) and Claude (chat_messages list).
 */
export function extractTranscripts(json: unknown): Transcript[] {
  if (!Array.isArray(json)) return [];
  const out: Transcript[] = [];

  for (const conv of json) {
    if (!conv || typeof conv !== "object") continue;
    const c = conv as Record<string, unknown>;

    if (c.mapping && typeof c.mapping === "object") {
      // ChatGPT: mapping is a node graph; user turns are author.role === "user".
      const parts: string[] = [];
      for (const node of Object.values(c.mapping as Record<string, unknown>)) {
        const msg = (node as { message?: unknown })?.message as
          | {
              author?: { role?: string };
              content?: { content_type?: string; parts?: unknown[] };
            }
          | null
          | undefined;
        if (msg?.author?.role !== "user") continue;
        for (const p of msg.content?.parts ?? []) {
          if (typeof p === "string" && p.trim()) parts.push(p.trim());
        }
      }
      if (parts.length) {
        out.push({
          title: str(c.title) || "untitled",
          when: epochMs(c.update_time ?? c.create_time),
          userText: parts.join("\n"),
        });
      }
      continue;
    }

    if (Array.isArray(c.chat_messages)) {
      // Claude: flat message list; user turns are sender === "human".
      const parts: string[] = [];
      for (const m of c.chat_messages as Record<string, unknown>[]) {
        if (!m || m.sender !== "human") continue;
        if (typeof m.text === "string" && m.text.trim()) {
          parts.push(m.text.trim());
        } else if (Array.isArray(m.content)) {
          for (const block of m.content as { type?: string; text?: string }[]) {
            if (block?.type === "text" && block.text?.trim()) parts.push(block.text.trim());
          }
        }
      }
      if (parts.length) {
        out.push({
          title: str(c.name) || "untitled",
          when: epochMs(c.updated_at ?? c.created_at),
          userText: parts.join("\n"),
        });
      }
    }
  }

  return out;
}

export const CHUNK_CHARS = 20_000;

/**
 * Packs transcripts into model-call-sized chunks, newest first. When the export
 * is larger than the chunk budget allows, the oldest conversations fall off —
 * recent life beats ancient history, and the caller reports the truncation.
 */
export function chunkTranscripts(
  transcripts: Transcript[],
  { chunkChars = CHUNK_CHARS, maxChunks = 12 }: { chunkChars?: number; maxChunks?: number } = {},
): { chunks: string[]; used: number; total: number } {
  const sorted = [...transcripts].sort((a, b) => b.when - a.when);
  const chunks: string[] = [];
  let current = "";
  let used = 0;

  for (const t of sorted) {
    const entry = `### Conversation: ${t.title}\n${t.userText.slice(0, chunkChars)}\n\n`;
    if (current && current.length + entry.length > chunkChars) {
      chunks.push(current);
      current = "";
      if (chunks.length >= maxChunks) break;
    }
    current += entry;
    used++;
  }
  if (current && chunks.length < maxChunks) chunks.push(current);

  return { chunks, used: Math.min(used, transcripts.length), total: transcripts.length };
}

export interface ImportSummary {
  chunksProcessed: number;
  paths: string[];
}

/** Distills the chunks into memory documents. One model call per chunk, sequential. */
export async function importChunks(
  userId: string,
  ws: NonNullable<Awaited<ReturnType<typeof getWorkspaceContext>>>,
  chunks: string[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<ImportSummary> {
  const paths = new Set<string>();
  let processed = 0;

  for (const chunk of chunks) {
    if (signal?.aborted) break;
    const res = await withRetry(
      () =>
        genai().interactions.create({
          model: MODELS.writer(),
          input: chunk,
          system_instruction: INSTRUCTION,
          response_format: { type: "text", mime_type: "application/json", schema: UPSERT_SCHEMA },
          store: false,
        } as never),
      { signal },
    );
    processed++;

    for (const u of parseUpserts(res).slice(0, 8)) {
      const path = normalizePath(u.path);
      if (!path || !ws.memoryFolderId) continue;
      try {
        await applyUpsert(userId, ws.client, ws.memoryFolderId, path, u);
        paths.add(path);
      } catch {
        // One document failing shouldn't abandon the rest of the import.
      }
    }
  }

  return { chunksProcessed: processed, paths: [...paths] };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function epochMs(v: unknown): number {
  if (typeof v === "number") return v > 10_000_000_000 ? v : v * 1000;
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return Date.parse(v);
  return 0;
}
