import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/google/tokens";
import { getFileVersion, readMemoryFile, trashMemoryFile, writeMemoryFile } from "@/lib/memory/drive-store";
import { parseMemoryDoc, serializeMemoryDoc } from "@/lib/memory/doc";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Generous for prose, small enough that nobody pastes a dataset into their memory. */
const MAX_BODY_BYTES = 64_000;

/**
 * Editing a memory document from the Memory page.
 *
 * This exists because Google Drive cannot edit .md files in place — its UI only
 * previews them, and "Open with Google Docs" edits a converted copy the agent
 * never reads. So the app is the editor: the body is rewritten around the
 * document's existing frontmatter and written back to the same Drive file, which
 * stays the source of truth.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = ((await req.json()) as { body?: unknown })?.body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "body must be a non-empty string" }, { status: 400 });
  }
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "document too large" }, { status: 413 });
  }

  const doc = await prisma.memoryDoc.findFirst({
    where: { id, userId: session.user.id, deletedAt: null },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ws = await getWorkspaceContext(session.user.id);
  if (!ws) {
    // Drive is the source of truth; editing only the mirror would be undone by the
    // next sync. Better to say why than to half-save.
    return NextResponse.json({ error: "workspace_not_connected" }, { status: 409 });
  }

  // Version before content: writeMemoryFile re-checks this version right before
  // writing, so a memory-writer update landing in between surfaces as a conflict
  // instead of being clobbered.
  let expectedVersion: string | null;
  let raw: string;
  try {
    expectedVersion = await getFileVersion(ws.client, doc.driveFileId);
    raw = await readMemoryFile(ws.client, doc.driveFileId);
  } catch {
    return NextResponse.json(
      { error: "drive_file_unreachable" },
      { status: 409 },
    );
  }

  const parsed = parseMemoryDoc(raw, doc.path);
  parsed.frontmatter.updated = new Date().toISOString();
  const content = serializeMemoryDoc({ frontmatter: parsed.frontmatter, body: body.trim() });

  const res = await writeMemoryFile(ws.client, {
    folderId: ws.memoryFolderId ?? "",
    path: doc.path,
    content,
    fileId: doc.driveFileId,
    expectedVersion,
  });
  if (res.conflict) {
    return NextResponse.json({ error: "conflict" }, { status: 409 });
  }

  const updated = await prisma.memoryDoc.update({
    where: { id: doc.id },
    data: { body: body.trim(), driveVersion: res.version, syncedAt: new Date() },
    select: { body: true, syncedAt: true },
  });

  return NextResponse.json({ ok: true, body: updated.body, syncedAt: updated.syncedAt.toISOString() });
}

/**
 * Forgetting a memory document.
 *
 * The Drive file is trashed as well as the mirror row tombstoned — leaving the file
 * behind would mean the next sync faithfully restores something the user asked to be
 * forgotten.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;

  const doc = await prisma.memoryDoc.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const ws = await getWorkspaceContext(session.user.id);
  if (ws) {
    await trashMemoryFile(ws.client, doc.driveFileId).catch(() => {
      // Already gone, or Drive is unreachable: the tombstone below still stops it
      // being used, and the next full sync reconciles.
    });
  }

  await prisma.memoryDoc.update({
    where: { id: doc.id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
