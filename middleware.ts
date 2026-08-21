import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge gate.
 *
 * This deliberately does NOT use NextAuth's `auth()` wrapper. The app uses database
 * sessions, whose cookie is an opaque token; `auth()` without the Prisma adapter
 * falls back to the JWT strategy and tries to *decode* that token, fails, and treats
 * every signed-in user as anonymous. The adapter itself cannot run on Edge, so there
 * is nothing here that can validate a session properly.
 *
 * So this checks only that a session cookie is present — enough to redirect
 * anonymous traffic cheaply — and every page and route re-checks with the real
 * `auth()` in the Node runtime before touching data. Presence is a hint, never
 * authorization.
 */
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => Boolean(req.cookies.get(name)?.value));
}

/**
 * Cloud Run answers on two URLs (a hashed one and a project-number one). OAuth
 * cannot span them: the PKCE cookie is set on whichever host served /login, but
 * Google always redirects back to the AUTH_URL host, and the cookie isn't there —
 * sign-in dies with InvalidCheck. Everyone gets bounced to the canonical host
 * before any cookie is involved.
 */
export function canonicalHost(): string | null {
  const url = process.env.AUTH_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The host the BROWSER used, from the forwarded headers — never req.nextUrl.host.
 * On Cloud Run the URL Next sees is the container-internal 0.0.0.0:8080, so
 * comparing nextUrl.host against the canonical host mismatches on every request
 * and 308s the canonical URL to itself, an infinite loop that took the whole
 * site down. (Found live, the hard way.)
 */
export function requestHost(headers: Headers): string | null {
  return headers.get("x-forwarded-host") ?? headers.get("host");
}

export function isForeignHost(headers: Headers, canonical: string | null): boolean {
  const host = requestHost(headers);
  return Boolean(canonical && host && host.toLowerCase() !== canonical.toLowerCase());
}

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const canonical = canonicalHost();
  if (canonical && isForeignHost(req.headers, canonical)) {
    const url = req.nextUrl.clone();
    url.host = canonical;
    url.protocol = "https";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }
  const isPublic = pathname === "/login" || pathname.startsWith("/api/auth");
  const signedIn = hasSessionCookie(req);

  if (!signedIn && !isPublic) {
    // API routes get a 401 they can act on. Redirecting them would hand `fetch` an
    // HTML login page with a 200, which surfaces as a JSON parse error miles from
    // the actual cause.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const url = new URL("/login", req.nextUrl.origin);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/search", req.nextUrl.origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
