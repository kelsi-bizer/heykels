import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { SearchApp, type InitialTurn } from "@/components/SearchApp";
import type { SourceRef } from "@/lib/pipeline/events";
import { notFound, redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SearchThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;

  const [searches, search] = await Promise.all([
    prisma.search.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
      take: 50,
    }),
    prisma.search.findFirst({
      // Scoped by userId as well as id: an id alone would let anyone read
      // anyone else's thread by guessing.
      where: { id, userId: session.user.id },
      include: { turns: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  if (!search) notFound();

  const initialTurns: InitialTurn[] = search.turns.map((t) => ({
    id: t.id,
    query: t.query,
    answer: t.answer,
    sources: (t.sources as SourceRef[] | null) ?? [],
    // A lightweight flag, not the image itself — re-serving megabytes of base64
    // into every thread render is not worth a thumbnail after refresh.
    hasImage: Boolean(t.imageMime),
  }));

  const firstName = (session.user.name ?? "there").split(" ")[0];

  return (
    <Shell searches={searches} user={session.user}>
      <SearchApp searchId={search.id} initialTurns={initialTurns} firstName={firstName} />
    </Shell>
  );
}
