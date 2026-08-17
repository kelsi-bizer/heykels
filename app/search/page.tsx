import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { SearchApp } from "@/components/SearchApp";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewSearchPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const searches = await prisma.search.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true },
    take: 50,
  });

  const firstName = (session.user.name ?? "there").split(" ")[0];

  return (
    <Shell searches={searches} user={session.user}>
      <SearchApp searchId={null} initialTurns={[]} firstName={firstName} />
    </Shell>
  );
}
