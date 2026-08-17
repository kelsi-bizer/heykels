import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Titles come straight from the first query, trimmed to something sidebar-sized. */
function toTitle(query: string): string {
  const clean = query.replace(/\s+/g, " ").trim();
  if (clean.length <= 48) return clean || "New search";
  return clean.slice(0, 47).replace(/\s\S*$/, "") + "…";
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let title = "New search";
  try {
    const body = (await req.json()) as { title?: string };
    if (typeof body.title === "string") title = toTitle(body.title);
  } catch {
    // Empty body is fine — the default title stands.
  }

  const search = await prisma.search.create({
    data: { userId: session.user.id, title },
    select: { id: true, title: true },
  });

  return NextResponse.json(search, { status: 201 });
}
