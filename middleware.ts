import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge runtime: this uses the adapter-free config, so it only checks that a session
// cookie is present and valid — never that it maps to a live database row. Routes
// and server components re-check with the real `auth()` before touching data.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/api/auth");

  if (!req.auth && !isPublic) {
    const url = new URL("/login", req.nextUrl.origin);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return Response.redirect(url);
  }
  if (req.auth && pathname === "/login") {
    return Response.redirect(new URL("/search", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
