import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { PATH_SEPARATOR, filenameToPath, pathToFilename } from "./doc";

/**
 * Marks a Drive file as HeyKels memory.
 *
 * Kept to a single tiny key on purpose: appProperties are capped at 124 bytes per
 * key+value pair and 30 pairs per file, and they are scoped to the OAuth client id —
 * rotating credentials would orphan every document. Tags and titles live in the
 * markdown frontmatter, where the user can see and edit them.
 */
export const MEMORY_APP_PROPERTY = { key: "heykels", value: "memory" } as const;

export const MEMORY_FOLDER_NAME = "HeyKels Memory";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,version,modifiedTime,trashed,appProperties";

export interface DriveMemoryFile {
  id: string;
  path: string;
  version: string | null;
  modifiedTime: string | null;
}

const driveFor = (auth: OAuth2Client) => google.drive({ version: "v3", auth });

/** Finds or creates the memory folder. Idempotent, so it can run on every connect. */
export async function ensureMemoryFolder(auth: OAuth2Client): Promise<string> {
  const drive = driveFor(auth);
  const existing = await drive.files.list({
    q: `mimeType = '${FOLDER_MIME}' and name = '${MEMORY_FOLDER_NAME}' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
  });
  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await drive.files.create({
    requestBody: {
      name: MEMORY_FOLDER_NAME,
      mimeType: FOLDER_MIME,
      appProperties: { [MEMORY_APP_PROPERTY.key]: MEMORY_APP_PROPERTY.value },
    },
    fields: "id",
  });
  return created.data.id!;
}

export async function listMemoryFiles(
  auth: OAuth2Client,
  folderId: string,
): Promise<DriveMemoryFile[]> {
  const drive = driveFor(auth);
  const out: DriveMemoryFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      pageSize: 200,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      if (!f.id || !f.name) continue;
      out.push({
        id: f.id,
        path: filenameToPath(f.name),
        version: f.version ?? null,
        modifiedTime: f.modifiedTime ?? null,
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

export async function readMemoryFile(auth: OAuth2Client, fileId: string): Promise<string> {
  const drive = driveFor(auth);
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
  return String(res.data);
}

export async function getFileVersion(auth: OAuth2Client, fileId: string): Promise<string | null> {
  const drive = driveFor(auth);
  const res = await drive.files.get({ fileId, fields: "version" });
  return res.data.version ?? null;
}

/**
 * Creates or updates a memory document.
 *
 * Drive v3 has no If-Match, so there is no atomic compare-and-swap. `expectedVersion`
 * gives an optimistic check: the caller re-reads and re-merges when it doesn't hold,
 * which matters because two searches finishing close together can both target the
 * same document.
 */
export async function writeMemoryFile(
  auth: OAuth2Client,
  {
    folderId,
    path,
    content,
    fileId,
    expectedVersion,
  }: {
    folderId: string;
    path: string;
    content: string;
    fileId?: string | null;
    expectedVersion?: string | null;
  },
): Promise<{ id: string; version: string | null; conflict: boolean }> {
  const drive = driveFor(auth);
  const name = pathToFilename(path);
  const media = { mimeType: "text/markdown", body: content };

  if (fileId) {
    if (expectedVersion) {
      const current = await getFileVersion(auth, fileId);
      if (current && current !== expectedVersion) {
        return { id: fileId, version: current, conflict: true };
      }
    }
    const res = await drive.files.update({ fileId, media, fields: "id,version" });
    return { id: res.data.id!, version: res.data.version ?? null, conflict: false };
  }

  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: "text/markdown",
      appProperties: { [MEMORY_APP_PROPERTY.key]: MEMORY_APP_PROPERTY.value },
    },
    media,
    fields: "id,version",
  });
  return { id: res.data.id!, version: res.data.version ?? null, conflict: false };
}

export async function trashMemoryFile(auth: OAuth2Client, fileId: string): Promise<void> {
  await driveFor(auth).files.update({ fileId, requestBody: { trashed: true } });
}

/** Cursor for incremental sync, taken once at connect time. */
export async function getStartPageToken(auth: OAuth2Client): Promise<string | null> {
  const res = await driveFor(auth).changes.getStartPageToken({});
  return res.data.startPageToken ?? null;
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  name: string | null;
  version: string | null;
  modifiedTime: string | null;
  isMemory: boolean;
}

/** Changes since the cursor, so a sync costs one small call instead of a full listing. */
export async function listChanges(
  auth: OAuth2Client,
  pageToken: string,
): Promise<{ changes: DriveChange[]; newStartPageToken: string | null }> {
  const drive = driveFor(auth);
  const changes: DriveChange[] = [];
  let token: string | undefined = pageToken;
  let newStartPageToken: string | null = null;

  while (token) {
    // Annotated explicitly: `token` is reassigned from this result, so inference
    // would otherwise be circular.
    const res: { data: drive_v3.Schema$ChangeList } = await drive.changes.list({
      pageToken: token,
      fields: `nextPageToken, newStartPageToken, changes(fileId, removed, file(${FILE_FIELDS}))`,
      pageSize: 200,
    });
    for (const c of res.data.changes ?? []) {
      if (!c.fileId) continue;
      const f = c.file;
      changes.push({
        fileId: c.fileId,
        removed: Boolean(c.removed) || Boolean(f?.trashed),
        name: f?.name ?? null,
        version: f?.version ?? null,
        modifiedTime: f?.modifiedTime ?? null,
        isMemory: f?.appProperties?.[MEMORY_APP_PROPERTY.key] === MEMORY_APP_PROPERTY.value,
      });
    }
    newStartPageToken = res.data.newStartPageToken ?? newStartPageToken;
    token = res.data.nextPageToken ?? undefined;
  }

  return { changes, newStartPageToken };
}

export { PATH_SEPARATOR };
