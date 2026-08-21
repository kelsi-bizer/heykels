import { prisma } from "@/lib/db";
import { MODELS, genai, withRetry } from "@/lib/pipeline/client";
import { getWorkspaceContext } from "@/lib/google/tokens";
import {
  mergeMemoryDocs,
  parseMemoryDoc,
  serializeMemoryDoc,
  setSection,
  type MemoryDocument,
} from "./doc";
import { writeMemoryFile } from "./drive-store";

const INSTRUCTION = `You maintain a user's long-term memory as markdown documents.

Given a search they ran and the answer they received, decide what is worth remembering
about the *user* — their projects, interests, preferences, relationships, constraints.

Rules:
- Record facts about the person, never facts about the world. "Prefers concise answers"
  belongs here; "Postgres 16 was released in 2023" does not.
- Nothing worth keeping is the normal case. Return an empty array rather than inventing.
- Use short, stable, kebab-case paths grouped by kind, e.g. "profile/basics",
  "interests/ai-search", "projects/heykels", "entities/people".
- Each fact must stand alone, without the surrounding conversation.`;

const SCHEMA = {
  type: "object",
  properties: {
    upserts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "e.g. interests/ai-search" },
          title: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          summary: { type: "string", description: "One or two sentences." },
          facts: { type: "array", items: { type: "string" } },
          openQuestions: { type: "array", items: { type: "string" } },
        },
        required: ["path", "title", "facts"],
      },
    },
  },
  required: ["upserts"],
} as const;

export interface Upsert {
  path: string;
  title: string;
  tags?: string[];
  summary?: string;
  facts: string[];
  openQuestions?: string[];
}

export { SCHEMA as UPSERT_SCHEMA };

/**
 * Leg D. Runs after the answer has been delivered, never in front of it.
 *
 * Returns the paths it wrote so the caller can report them. Failures are the
 * caller's to swallow: a memory write that didn't happen must never turn a
 * successful search into a failed one.
 */
export async function writeMemoryFromTurn(
  userId: string,
  query: string,
  answer: string,
): Promise<string[]> {
  const ws = await getWorkspaceContext(userId);
  if (!ws?.memoryFolderId) return [];

  const res = await withRetry(() =>
    genai().interactions.create({
      model: MODELS.writer(),
      input: `Search: ${query}\n\nAnswer given:\n${answer.slice(0, 8000)}`,
      system_instruction: INSTRUCTION,
      response_format: { type: "text", mime_type: "application/json", schema: SCHEMA },
      store: false,
    } as never),
  );

  const upserts = parseUpserts(res);
  if (upserts.length === 0) return [];

  const written: string[] = [];
  for (const u of upserts.slice(0, 4)) {
    const path = normalizePath(u.path);
    if (!path) continue;
    try {
      await applyUpsert(userId, ws.client, ws.memoryFolderId, path, u);
      written.push(path);
    } catch {
      // One document failing shouldn't abandon the rest.
    }
  }
  return written;
}

export async function applyUpsert(
  userId: string,
  client: NonNullable<Awaited<ReturnType<typeof getWorkspaceContext>>>["client"],
  folderId: string,
  path: string,
  u: Upsert,
) {
  return applyDocument(userId, client, folderId, path, buildDocument(path, u));
}

/**
 * Writes one memory document to Drive and the mirror, merging into any existing
 * document at the path. Shared by the turn writer, the importer, and new notes.
 */
export async function applyDocument(
  userId: string,
  client: NonNullable<Awaited<ReturnType<typeof getWorkspaceContext>>>["client"],
  folderId: string,
  path: string,
  incoming: MemoryDocument,
) {
  const attempt = async (): Promise<boolean> => {
    const existingRow = await prisma.memoryDoc.findUnique({
      where: { userId_path: { userId, path } },
    });

    const merged =
      existingRow && !existingRow.deletedAt
        ? mergeMemoryDocs(
            parseMemoryDoc(`---\nid: ${path}\ntitle: ${existingRow.title}\n---\n${existingRow.body}`, path),
            incoming,
          )
        : incoming;

    const result = await writeMemoryFile(client, {
      folderId,
      path,
      content: serializeMemoryDoc(merged),
      fileId: existingRow?.driveFileId ?? null,
      expectedVersion: existingRow?.driveVersion ?? null,
    });

    if (result.conflict) return false;

    await prisma.memoryDoc.upsert({
      where: { userId_path: { userId, path } },
      create: {
        userId,
        path,
        title: merged.frontmatter.title,
        tags: merged.frontmatter.tags,
        body: merged.body,
        driveFileId: result.id,
        driveVersion: result.version,
        syncedAt: new Date(),
      },
      update: {
        title: merged.frontmatter.title,
        tags: merged.frontmatter.tags,
        body: merged.body,
        driveFileId: result.id,
        driveVersion: result.version,
        syncedAt: new Date(),
        deletedAt: null,
      },
    });
    return true;
  };

  // One retry: a version conflict means someone else wrote in between, so re-read
  // and re-merge rather than clobbering what they added.
  if (!(await attempt())) {
    await refreshVersion(userId, path, client);
    await attempt();
  }
}

async function refreshVersion(
  userId: string,
  path: string,
  client: NonNullable<Awaited<ReturnType<typeof getWorkspaceContext>>>["client"],
) {
  const row = await prisma.memoryDoc.findUnique({ where: { userId_path: { userId, path } } });
  if (!row) return;
  const { readMemoryFile, getFileVersion } = await import("./drive-store");
  const [raw, version] = await Promise.all([
    readMemoryFile(client, row.driveFileId).catch(() => null),
    getFileVersion(client, row.driveFileId).catch(() => null),
  ]);
  if (raw === null) return;
  const doc = parseMemoryDoc(raw, path);
  await prisma.memoryDoc.update({
    where: { userId_path: { userId, path } },
    data: { body: doc.body, tags: doc.frontmatter.tags, driveVersion: version },
  });
}

export function buildDocument(path: string, u: Upsert): MemoryDocument {
  let body = "";
  if (u.summary) body = `## Summary\n${u.summary}`;
  body = setSection(body, "Facts", u.facts);
  if (u.openQuestions?.length) body = setSection(body, "Open questions", u.openQuestions);

  return {
    frontmatter: {
      id: path.replace(/\.md$/, ""),
      title: u.title || path,
      tags: u.tags ?? [],
      updated: new Date().toISOString(),
      confidence: 0.7,
    },
    body,
  };
}

/** Keeps model-chosen paths inside the memory folder and free of traversal. */
export function normalizePath(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9/_-]/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (!cleaned || cleaned.includes("..")) return null;
  if (cleaned.split("/").length > 3) return null;
  return `${cleaned}.md`;
}

export function parseUpserts(res: unknown): Upsert[] {
  const r = res as { steps?: { content?: { text?: string }[] }[]; output_text?: string };
  const text =
    (r?.steps ?? [])
      .flatMap((s) => s.content ?? [])
      .map((c) => c.text ?? "")
      .join("") || r?.output_text || "";
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const obj = JSON.parse(cleaned) as { upserts?: unknown };
    if (!Array.isArray(obj.upserts)) return [];
    return obj.upserts.filter(
      (u): u is Upsert =>
        !!u &&
        typeof u === "object" &&
        typeof (u as Upsert).path === "string" &&
        Array.isArray((u as Upsert).facts),
    );
  } catch {
    return [];
  }
}
