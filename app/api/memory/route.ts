import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/google/tokens";
import { applyDocument, normalizePath } from "@/lib/memory/writer";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64_000;

/**
 * Creating a memory note by hand.
 *
 * The body is stored exactly as typed — no distillation. A hand-written note is
 * already the distilled form; the title becomes a notes/<slug> path. An existing
 * path gets a numeric suffix rather than a merge: mergeMemoryDocs unions
 * ## sections, and a free-form note may have none, which would silently no-op.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let title: unknown, body: unknown;
  try {
    ({ title, body } = (await req.json()) as { title?: unknown; body?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "note too large" }, { status: 413 });
  }

  const ws = await getWorkspaceContext(session.user.id);
  if (!ws?.memoryFolderId) {
    return NextResponse.json({ error: "workspace_not_connected" }, { status: 409 });
  }

  const base = normalizePath(`notes/${title.trim().slice(0, 60)}`);
  if (!base) return NextResponse.json({ error: "unusable title" }, { status: 400 });

  let path = base;
  for (let i = 2; i <= 20; i++) {
    const existing = await prisma.memoryDoc.findUnique({
      where: { userId_path: { userId: session.user.id, path } },
      select: { deletedAt: true },
    });
    if (!existing || existing.deletedAt) break;
    path = base.replace(/\.md$/, `-${i}.md`);
  }

  await applyDocument(session.user.id, ws.client, ws.memoryFolderId, path, {
    frontmatter: {
      id: path.replace(/\.md$/, ""),
      title: title.trim(),
      tags: ["note"],
      updated: new Date().toISOString(),
      confidence: 0.9,
    },
    body: body.trim(),
  });

  return NextResponse.json({ ok: true, path });
}
