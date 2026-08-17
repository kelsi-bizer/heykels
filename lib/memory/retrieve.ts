import { prisma } from "@/lib/db";

export interface RetrievedDoc {
  path: string;
  title: string;
  tags: string[];
  body: string;
  score: number;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "been", "my", "me", "i", "we", "our", "you", "your",
  "it", "this", "that", "what", "how", "why", "when", "who", "do", "does", "did",
  "can", "should", "would", "about", "from", "at", "by", "as", "if", "so",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/**
 * Ranks memory documents against a query by keyword overlap.
 *
 * Reads only from the Prisma mirror, never from Drive — the search path must not
 * wait on a Drive round trip, and Drive would rate-limit under any real usage.
 * Keyword ranking is the deliberate first cut; embeddings are the obvious upgrade
 * once there is enough of a corpus for the difference to matter.
 */
export async function retrieve(
  userId: string,
  query: string,
  limit = 6,
): Promise<RetrievedDoc[]> {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const docs = await prisma.memoryDoc.findMany({
    where: { userId, deletedAt: null },
    select: { path: true, title: true, tags: true, body: true },
    take: 200,
  });

  return docs
    .map((d) => ({ ...d, score: scoreDoc(terms, d) }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Tags and titles are curated, so a hit there means more than one in the prose. */
export function scoreDoc(
  terms: string[],
  doc: { path: string; title: string; tags: string[]; body: string },
): number {
  const tags = new Set(doc.tags.map((t) => t.toLowerCase()));
  const title = new Set(tokenize(doc.title));
  const path = new Set(tokenize(doc.path));
  const bodyTokens = tokenize(doc.body);
  const bodyCounts = new Map<string, number>();
  for (const t of bodyTokens) bodyCounts.set(t, (bodyCounts.get(t) ?? 0) + 1);

  let score = 0;
  for (const term of terms) {
    if (tags.has(term)) score += 5;
    if (title.has(term)) score += 4;
    if (path.has(term)) score += 3;
    const n = bodyCounts.get(term) ?? 0;
    // Diminishing returns: a doc that says a word 40 times isn't 40x as relevant.
    if (n > 0) score += Math.min(3, 1 + Math.log2(n));
  }
  return score;
}
