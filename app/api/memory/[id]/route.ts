import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/google/tokens";
import { trashMemoryFile } from "@/lib/memory/drive-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
