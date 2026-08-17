import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { oauthClient } from "@/lib/google/tokens";
import { WORKSPACE_SCOPE_STRINGS } from "@/lib/google/scopes";

export const runtime = "nodejs";

export const STATE_COOKIE = "heykels_oauth_state";

export function signState(nonce: string, secret: string): string {
  return createHmac("sha256", secret).update(nonce).digest("base64url");
}

export function verifyState(nonce: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signState(nonce, secret));
  const given = Buffer.from(signature);
  // Length check first: timingSafeEqual throws on a length mismatch.
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Starts the Workspace consent flow.
 *
 * Hand-rolled rather than a second Auth.js signIn: Auth.js has unresolved issues
 * where re-consenting with new scopes completes the Google round trip but never
 * updates the stored account, leaving the token narrower than the UI believes.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("unauthenticated", { status: 401 });

  const secret = process.env.AUTH_SECRET;
  if (!secret) return new Response("AUTH_SECRET is not set", { status: 500 });

  const nonce = randomBytes(16).toString("base64url");
  const state = `${nonce}.${signState(nonce, secret)}`;

  const url = oauthClient().generateAuthUrl({
    access_type: "offline",
    // Forces Google to re-issue a refresh token. Without it, a returning user who
    // already consented gets an access token and nothing to refresh with.
    prompt: "consent",
    include_granted_scopes: true,
    scope: WORKSPACE_SCOPE_STRINGS,
    state,
  });

  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return Response.redirect(url);
}
