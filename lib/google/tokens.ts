import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export interface WorkspaceContext {
  client: OAuth2Client;
  grantedScopes: string[];
  memoryFolderId: string | null;
  driveStartPageToken: string | null;
}

export function oauthClient(): OAuth2Client {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret) throw new Error("Google OAuth client is not configured.");
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

/**
 * Builds an authorized client for a user, or null if they have not connected Workspace.
 *
 * google-auth-library refreshes the access token on its own when a refresh token is
 * present, but the rotated values only exist in memory unless we listen for them. The
 * listener is attached per request rather than at module scope: Cloud Run reuses warm
 * instances across requests, and a module-level listener would accumulate one handler
 * per request until the process leaked.
 */
export async function getWorkspaceContext(userId: string): Promise<WorkspaceContext | null> {
  const grant = await prisma.googleGrant.findUnique({ where: { userId } });
  if (!grant) return null;

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(grant.encryptedRefreshToken);
  } catch {
    // Key rotation or a corrupted value: treat as disconnected so the UI prompts a
    // reconnect rather than throwing on every search.
    return null;
  }

  const client = oauthClient();
  client.setCredentials({
    refresh_token: refreshToken,
    access_token: grant.accessToken ?? undefined,
    expiry_date: grant.expiresAt?.getTime(),
  });

  client.on("tokens", (tokens) => {
    void prisma.googleGrant
      .update({
        where: { userId },
        data: {
          accessToken: tokens.access_token ?? grant.accessToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : grant.expiresAt,
          // Google only returns a refresh token on first consent. Coalescing rather
          // than assigning is what stops a routine refresh from nulling it out and
          // silently disconnecting the user.
          encryptedRefreshToken: tokens.refresh_token
            ? encryptSecret(tokens.refresh_token)
            : grant.encryptedRefreshToken,
        },
      })
      .catch(() => {
        // Losing a rotated access token is recoverable: the next call refreshes again.
      });
  });

  return {
    client,
    grantedScopes: grant.grantedScopes,
    memoryFolderId: grant.memoryFolderId,
    driveStartPageToken: grant.driveStartPageToken,
  };
}

/**
 * While the OAuth app is unverified, Google expires refresh tokens after 7 days.
 * Surfacing that as a banner is the difference between "the app is broken" and
 * "Google needs you to reconnect".
 */
export const UNVERIFIED_TOKEN_LIFETIME_DAYS = 7;

export function grantLikelyExpired(connectedAt: Date, now = new Date()): boolean {
  const days = (now.getTime() - connectedAt.getTime()) / 86_400_000;
  return days >= UNVERIFIED_TOKEN_LIFETIME_DAYS;
}
