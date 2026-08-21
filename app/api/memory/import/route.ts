import JSZip from "jszip";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWorkspaceContext } from "@/lib/google/tokens";
import { chunkTranscripts, extractTranscripts, importChunks } from "@/lib/memory/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A large export takes several sequential model calls to distill.
export const maxDuration = 300;

const MAX_FILES = 5;
const MAX_FILE_BYTES = 25_000_000; // Cloud Run caps requests at 32MB
const MAX_JSON_BYTES = 40_000_000; // uncompressed conversations.json ceiling
const MAX_CHUNKS_PER_REQUEST = 12; // model-call budget for one import

/**
 * POST multipart/form-data: files[] = ChatGPT/Claude export .zip, a bare
 * conversations.json, or pasted memory as .txt/.md.
 *
 * Distills the user's own words into memory documents. Responds with what was
 * read and what was written; when an export is bigger than the chunk budget the
 * oldest conversations are dropped and the response says so.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const ws = await getWorkspaceContext(session.user.id);
  if (!ws?.memoryFolderId) {
    return NextResponse.json({ error: "workspace_not_connected" }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "no files" }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `at most ${MAX_FILES} files at once` }, { status: 400 });
  }

  const perFile: {
    name: string;
    kind: string;
    conversations: number;
    conversationsUsed: number;
    error?: string;
  }[] = [];
  const allChunks: string[] = [];

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      perFile.push({ name: file.name, kind: "too-large", conversations: 0, conversationsUsed: 0, error: "over 25MB" });
      continue;
    }
    try {
      const { kind, chunkSource } = await readFile(file);
      if (typeof chunkSource === "string") {
        // Pasted memory text: chunk it directly, no transcript structure to mine.
        const budget = MAX_CHUNKS_PER_REQUEST - allChunks.length;
        for (let i = 0; i < chunkSource.length && allChunks.length < MAX_CHUNKS_PER_REQUEST; i += 20_000) {
          allChunks.push(chunkSource.slice(i, i + 20_000));
        }
        perFile.push({
          name: file.name,
          kind,
          conversations: 1,
          conversationsUsed: budget > 0 ? 1 : 0,
        });
      } else {
        const transcripts = extractTranscripts(chunkSource);
        const { chunks, used } = chunkTranscripts(transcripts, {
          maxChunks: Math.max(0, MAX_CHUNKS_PER_REQUEST - allChunks.length),
        });
        allChunks.push(...chunks);
        perFile.push({
          name: file.name,
          kind,
          conversations: transcripts.length,
          conversationsUsed: used,
        });
      }
    } catch (err) {
      perFile.push({
        name: file.name,
        kind: "unreadable",
        conversations: 0,
        conversationsUsed: 0,
        error: (err as Error).message.slice(0, 120),
      });
    }
  }

  if (allChunks.length === 0) {
    return NextResponse.json({ files: perFile, chunksProcessed: 0, paths: [] });
  }

  const summary = await importChunks(session.user.id, ws, allChunks, { signal: req.signal });
  return NextResponse.json({ files: perFile, ...summary });
}

async function readFile(file: File): Promise<{ kind: string; chunkSource: string | unknown }> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    // Both ChatGPT and Claude exports ship a conversations.json at the root.
    const entry =
      zip.file("conversations.json") ?? zip.file(/(^|\/)conversations\.json$/i)[0] ?? null;
    if (!entry) throw new Error("no conversations.json in the zip — is this a data export?");
    const text = await entry.async("string");
    if (text.length > MAX_JSON_BYTES) throw new Error("conversations.json over 40MB");
    return { kind: "export-zip", chunkSource: JSON.parse(text) };
  }

  if (name.endsWith(".json")) {
    const text = await file.text();
    if (text.length > MAX_JSON_BYTES) throw new Error("file over 40MB");
    return { kind: "conversations-json", chunkSource: JSON.parse(text) };
  }

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    const text = (await file.text()).trim();
    if (!text) throw new Error("empty file");
    return { kind: "memory-text", chunkSource: text };
  }

  throw new Error("unsupported file type — use .zip, .json, .txt or .md");
}
