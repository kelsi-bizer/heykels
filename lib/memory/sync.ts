import { prisma } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/google/tokens";
import { parseMemoryDoc } from "./doc";
import {
  getStartPageToken,
  listChanges,
  listMemoryFiles,
  readMemoryFile,
} from "./drive-store";

/**
 * Pulls Drive into the Prisma mirror.
 *
 * Drive stays the source of truth — the user can edit or delete a memory file by hand
 * and that must win — but the search path reads only the mirror, so this runs on
 * connect and on a cursor afterwards rather than on every query.
 */
export async function syncMemoryFromDrive(userId: string): Promise<{ synced: number; removed: number }> {
  const ws = await getWorkspaceContext(userId);
  if (!ws?.memoryFolderId) return { synced: 0, removed: 0 };

  const grant = await prisma.googleGrant.findUnique({
    where: { userId },
    select: { driveStartPageToken: true },
  });

  return grant?.driveStartPageToken
    ? incremental(userId, ws.client, grant.driveStartPageToken)
    : full(userId, ws.client, ws.memoryFolderId);
}

type Client = NonNullable<Awaited<ReturnType<typeof getWorkspaceContext>>>["client"];

async function full(userId: string, client: Client, folderId: string) {
  const files = await listMemoryFiles(client, folderId);
  let synced = 0;

  for (const f of files) {
    const raw = await readMemoryFile(client, f.id).catch(() => null);
    if (raw === null) continue;
    await upsert(userId, f.path, raw, f.id, f.version, f.modifiedTime);
    synced++;
  }

  // Anything in the mirror that Drive no longer lists has been deleted by the user.
  const liveIds = files.map((f) => f.id);
  const { count: removed } = await prisma.memoryDoc.updateMany({
    where: { userId, deletedAt: null, driveFileId: { notIn: liveIds.length ? liveIds : ["__none__"] } },
    data: { deletedAt: new Date() },
  });

  const token = await getStartPageToken(client).catch(() => null);
  if (token) {
    await prisma.googleGrant.update({
      where: { userId },
      data: { driveStartPageToken: token },
    });
  }

  return { synced, removed };
}

async function incremental(userId: string, client: Client, pageToken: string) {
  const { changes, newStartPageToken } = await listChanges(client, pageToken);
  let synced = 0;
  let removed = 0;

  for (const c of changes) {
    if (c.removed) {
      const { count } = await prisma.memoryDoc.updateMany({
        where: { userId, driveFileId: c.fileId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      removed += count;
      continue;
    }
    // changes.list reports every file the user touched, not only ours.
    if (!c.isMemory || !c.name) continue;

    const raw = await readMemoryFile(client, c.fileId).catch(() => null);
    if (raw === null) continue;
    await upsert(
      userId,
      c.name.split("__").join("/"),
      raw,
      c.fileId,
      c.version,
      c.modifiedTime,
    );
    synced++;
  }

  if (newStartPageToken) {
    await prisma.googleGrant.update({
      where: { userId },
      data: { driveStartPageToken: newStartPageToken },
    });
  }

  return { synced, removed };
}

async function upsert(
  userId: string,
  path: string,
  raw: string,
  driveFileId: string,
  version: string | null,
  modifiedTime: string | null,
) {
  const doc = parseMemoryDoc(raw, path);
  const data = {
    title: doc.frontmatter.title,
    tags: doc.frontmatter.tags,
    body: doc.body,
    driveFileId,
    driveVersion: version,
    driveModifiedAt: modifiedTime ? new Date(modifiedTime) : null,
    syncedAt: new Date(),
    // A hand-restored file should come back rather than stay tombstoned.
    deletedAt: null,
  };
  await prisma.memoryDoc.upsert({
    where: { userId_path: { userId, path } },
    create: { userId, path, ...data },
    update: data,
  });
}
