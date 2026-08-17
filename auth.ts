import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./lib/db";
import { authConfig } from "./auth.config";

/**
 * Full Auth.js instance: the Edge-safe config plus the Prisma adapter and database
 * sessions. Node runtime only — never import this from middleware.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  callbacks: {
    ...authConfig.callbacks,
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
});

/** Throws instead of returning null, for routes that have already been gated. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
  return session.user as { id: string; name?: string | null; email?: string | null; image?: string | null };
}
