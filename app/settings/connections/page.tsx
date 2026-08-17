import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { WORKSPACE_SCOPES, missingScopes } from "@/lib/google/scopes";
import { UNVERIFIED_TOKEN_LIFETIME_DAYS, grantLikelyExpired } from "@/lib/google/tokens";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { connected, error } = await searchParams;

  const [searches, grant] = await Promise.all([
    prisma.search.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
      take: 50,
    }),
    prisma.googleGrant.findUnique({ where: { userId: session.user.id } }),
  ]);

  const granted = grant?.grantedScopes ?? [];
  const missing = missingScopes(granted);
  const stale = grant ? grantLikelyExpired(grant.connectedAt) : false;

  return (
    <Shell searches={searches} user={session.user}>
      <div className="scroll">
        <div className="wrap">
          <h1 className="page-h">Connections</h1>
          <p className="page-s">
            HeyKels acts in your Workspace only with your approval, and every action
            that changes something is confirmed before it runs.
          </p>

          {error && (
            <div className="err">
              {error === "state_mismatch"
                ? "That sign-in link didn't match this browser session. Please try connecting again."
                : error === "no_refresh_token"
                  ? "Google didn't return offline access. Try connecting again and accept all the permissions."
                  : `Couldn't connect: ${decodeURIComponent(error)}`}
            </div>
          )}
          {connected && !error && (
            <div className="banner" style={{ borderColor: "color-mix(in srgb,var(--ok) 45%,var(--border))" }}>
              Connected. Your memory folder is ready in Drive.
            </div>
          )}

          {grant && stale && (
            <div className="banner">
              <div>
                Google expires refresh tokens every {UNVERIFIED_TOKEN_LIFETIME_DAYS} days
                while an app is unverified, so this connection has probably lapsed.{" "}
                <a className="linkish" href="/api/google/connect">
                  Reconnect
                </a>{" "}
                to restore access.
              </div>
            </div>
          )}

          {!grant && (
            <div className="banner">
              <div>
                Not connected yet. Until you connect, searches still work — they just
                run on the web alone, with no memory of you.
              </div>
            </div>
          )}

          <div className="row">
            <div className="g">
              <div className="n">Google Workspace</div>
              <div className="d">
                {grant
                  ? `Connected ${grant.connectedAt.toLocaleDateString()} · Gmail, Calendar, Drive, Docs, Sheets`
                  : "Gmail, Calendar, Drive, Docs and Sheets"}
              </div>
            </div>
            <a className="btn p" href="/api/google/connect" style={{ textDecoration: "none" }}>
              {grant ? "Reconnect" : "Connect"}
            </a>
          </div>

          <h2 className="page-h" style={{ fontSize: 18, marginTop: 30 }}>
            Permissions
          </h2>
          <p className="page-s" style={{ marginBottom: 14 }}>
            Requested only when you connect — never at sign-in.
          </p>

          {WORKSPACE_SCOPES.map((s) => {
            const has = granted.includes(s.scope);
            return (
              <div className="row" key={s.scope}>
                <div className="g">
                  <div className="n">{s.reason}</div>
                  <div className="d">
                    <code style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
                      {s.scope.replace("https://www.googleapis.com/auth/", "")}
                    </code>
                    {s.klass === "restricted" && " · restricted scope"}
                    {s.klass === "sensitive" && " · sensitive scope"}
                  </div>
                </div>
                <span className={has ? "pill-ok" : "pill-no"}>{has ? "Granted" : "Not granted"}</span>
              </div>
            );
          })}

          {grant && missing.length > 0 && (
            <div className="err">
              Some permissions weren&apos;t granted, so the matching tools are switched
              off rather than failing mid-answer.{" "}
              <a className="linkish" href="/api/google/connect">
                Grant the rest
              </a>
              .
            </div>
          )}

          <div className="row" style={{ display: "block", marginTop: 24 }}>
            <div className="n" style={{ marginBottom: 6 }}>
              About verification
            </div>
            <div className="d" style={{ lineHeight: 1.6 }}>
              Gmail and full Drive access are <strong>restricted</strong> scopes. Before
              anyone outside your OAuth test-user list can grant them, the app needs
              Google verification plus an annual third-party security assessment. Until
              then Google expires refresh tokens every{" "}
              {UNVERIFIED_TOKEN_LIFETIME_DAYS} days, so expect to reconnect about weekly.
              That&apos;s a Google policy, not something the app can work around.
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
