import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { SIGNIN_SCOPES } from "./lib/google/scopes";

/**
 * Adapter-free Auth.js config.
 *
 * Middleware runs on the Edge runtime, where the Prisma adapter cannot run at all.
 * Keeping the adapter out of this file lets middleware import it safely; the full
 * config in auth.ts adds the adapter and is only imported from Node-runtime code.
 */
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope: SIGNIN_SCOPES.join(" "),
          // Sign-in deliberately does NOT request offline access. The Workspace
          // grant is a separate flow with its own refresh token (lib/google/tokens.ts),
          // so revoking one doesn't break the other.
          prompt: "select_account",
        },
      },
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
