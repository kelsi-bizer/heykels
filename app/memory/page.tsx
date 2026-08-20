import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { MemoryBrowser } from "@/components/MemoryBrowser";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [searches, docs, grant] = await Promise.all([
    prisma.search.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
      take: 50,
    }),
    prisma.memoryDoc.findMany({
      where: { userId: session.user.id, deletedAt: null },
      orderBy: { syncedAt: "desc" },
      select: { id: true, path: true, title: true, tags: true, body: true, syncedAt: true },
    }),
    prisma.googleGrant.findUnique({
      where: { userId: session.user.id },
      select: { memoryFolderId: true },
    }),
  ]);

  return (
    <Shell searches={searches} user={session.user}>
      <div className="scroll">
        <div className="wrap">
          <h1 className="page-h">Memory</h1>
          <p className="page-s">
            {grant?.memoryFolderId ? (
              <>
                Markdown files in{" "}
                <a
                  className="linkish"
                  href={`https://drive.google.com/drive/folders/${grant.memoryFolderId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Drive › HeyKels Memory
                </a>
                . You own them — edit any file right here with the pencil, or delete it
                here or in Drive, and the next search reflects it. (Drive itself can
                only preview .md files, not edit them.)
              </>
            ) : (
              <>
                Your memory lives in your own Google Drive as markdown files. Connect
                Workspace to start building it.
              </>
            )}
          </p>
          <MemoryBrowser
            docs={docs.map((d) => ({
              ...d,
              syncedAt: d.syncedAt.toISOString(),
            }))}
          />
        </div>
      </div>
    </Shell>
  );
}
