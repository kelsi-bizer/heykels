import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { oauthClient } from "@/lib/google/tokens";
import { ensureMemoryFolder, getStartPageToken, writeMemoryFile } from "@/lib/memory/drive-store";
import { serializeMemoryDoc } from "@/lib/memory/doc";
import { STATE_COOKIE, verifyState } from "../connect/route";

export const runtime = "nodejs";

/**
 * Redirects must be built on AUTH_URL, never on the request's own origin: on
 * Cloud Run the request URL the handler sees is the container-internal
 * http://0.0.0.0:8080, and a redirect built from it strands the browser on an
 * unreachable address the moment the OAuth round trip completes (hit live).
 */
function appUrl(path: string, req: Request): URL {
  return new URL(path, process.env.AUTH_URL || new URL(req.url).origin);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.redirect(appUrl("/login", req));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const settings = appUrl("/settings/connections", req);

  if (error) {
    settings.searchParams.set("error", error);
    return Response.redirect(settings);
  }
  if (!code || !state) {
    settings.searchParams.set("error", "missing_code");
    return Response.redirect(settings);
  }

  // CSRF: the state must match the cookie we set *and* carry our signature, so a
  // forged callback cannot attach someone else's Google account to this session.
  const jar = await cookies();
  const cookieState = jar.get(STATE_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET ?? "";
  const [nonce, signature] = state.split(".");

  if (!cookieState || cookieState !== state || !nonce || !signature || !verifyState(nonce, signature, secret)) {
    settings.searchParams.set("error", "state_mismatch");
    return Response.redirect(settings);
  }
  jar.delete(STATE_COOKIE);

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      // Without one there is no offline access, and every later call would fail
      // opaquely. Better to say so now.
      settings.searchParams.set("error", "no_refresh_token");
      return Response.redirect(settings);
    }
    client.setCredentials(tokens);

    const grantedScopes = (tokens.scope ?? "").split(" ").filter(Boolean);
    const userId = session.user.id;

    const folderId = await ensureMemoryFolder(client);
    const startToken = await getStartPageToken(client).catch(() => null);

    await prisma.googleGrant.upsert({
      where: { userId },
      create: {
        userId,
        encryptedRefreshToken: encryptSecret(tokens.refresh_token),
        accessToken: tokens.access_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        grantedScopes,
        memoryFolderId: folderId,
        driveStartPageToken: startToken,
        connectedAt: new Date(),
      },
      update: {
        encryptedRefreshToken: encryptSecret(tokens.refresh_token),
        accessToken: tokens.access_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        grantedScopes,
        memoryFolderId: folderId,
        driveStartPageToken: startToken,
        connectedAt: new Date(),
      },
    });

    await seedProfile(userId, client, folderId, session.user.name, session.user.email);

    settings.searchParams.set("connected", "1");
    return Response.redirect(settings);
  } catch (err) {
    settings.searchParams.set("error", encodeURIComponent((err as Error).message.slice(0, 120)));
    return Response.redirect(settings);
  }
}

/**
 * Writes a starter memory document at connect time.
 *
 * Without it the first search after connecting looks identical to a search before
 * connecting — the memory leg finds an empty corpus and short-circuits — and the
 * feature reads as broken on exactly the run where the user is looking for it.
 */
async function seedProfile(
  userId: string,
  client: ReturnType<typeof oauthClient>,
  folderId: string,
  name?: string | null,
  email?: string | null,
) {
  const path = "profile/basics.md";
  const existing = await prisma.memoryDoc.findUnique({
    where: { userId_path: { userId, path } },
  });
  if (existing) return;

  const facts = [
    name ? `Name: ${name}` : null,
    email ? `Email: ${email}` : null,
    "Connected Google Workspace to HeyKels",
  ].filter((f): f is string => Boolean(f));

  const content = serializeMemoryDoc({
    frontmatter: {
      id: "profile/basics",
      title: name ? `${name} — basics` : "Basics",
      tags: ["profile"],
      updated: new Date().toISOString(),
      confidence: 0.9,
    },
    body: [
      "## Summary",
      "Starter profile, created when Workspace was connected. HeyKels adds to this as it learns.",
      "",
      "## Facts",
      ...facts.map((f) => `- ${f}`),
      "",
      "## Open questions",
      "- What are you working on right now?",
    ].join("\n"),
  });

  try {
    const res = await writeMemoryFile(client, { folderId, path, content });
    await prisma.memoryDoc.create({
      data: {
        userId,
        path,
        title: name ? `${name} — basics` : "Basics",
        tags: ["profile"],
        body: content.split("---").slice(2).join("---").trim(),
        driveFileId: res.id,
        driveVersion: res.version,
      },
    });
  } catch {
    // A failed seed shouldn't fail the connection itself.
  }
}
