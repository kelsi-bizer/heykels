import matter from "gray-matter";

/**
 * Memory documents are markdown with YAML frontmatter, stored in the user's own
 * Google Drive. The format is chosen so a person can open, read, correct or delete
 * their own memory in Drive without the app in the loop — which is the entire point
 * of storing context this way instead of in an opaque profile table.
 */

export interface MemoryFrontmatter {
  id: string;
  title: string;
  tags: string[];
  updated: string;
  confidence: number;
}

export interface MemoryDocument {
  frontmatter: MemoryFrontmatter;
  /** Everything after the frontmatter block. */
  body: string;
}

export const MEMORY_SECTIONS = ["Summary", "Facts", "Open questions"] as const;

export function parseMemoryDoc(raw: string, fallbackId = "untitled"): MemoryDocument {
  const parsed = matter(raw);
  const d = parsed.data as Partial<MemoryFrontmatter>;

  return {
    frontmatter: {
      id: typeof d.id === "string" && d.id ? d.id : fallbackId,
      title: typeof d.title === "string" && d.title ? d.title : fallbackId,
      tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
      updated: normalizeDate(d.updated),
      confidence: typeof d.confidence === "number" ? clamp01(d.confidence) : 0.6,
    },
    body: parsed.content.trim(),
  };
}

export function serializeMemoryDoc(doc: MemoryDocument): string {
  const fm = doc.frontmatter;
  const tags = fm.tags.length ? `[${fm.tags.join(", ")}]` : "[]";
  return [
    "---",
    `id: ${fm.id}`,
    `title: ${yamlScalar(fm.title)}`,
    `tags: ${tags}`,
    `updated: ${fm.updated}`,
    `confidence: ${fm.confidence}`,
    "---",
    "",
    doc.body.trim(),
    "",
  ].join("\n");
}

/** Pulls the bullet lines out of a `## Heading` section. */
export function sectionBullets(body: string, heading: string): string[] {
  const re = new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`, "im");
  const m = re.exec(body);
  if (!m) return [];
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(/^##\s+/m);
  const block = end === -1 ? rest : rest.slice(0, end);
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

export function setSection(body: string, heading: string, bullets: string[]): string {
  const rendered = `## ${heading}\n${bullets.map((b) => `- ${b}`).join("\n")}`;
  const re = new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`, "im");
  const m = re.exec(body);
  if (!m) return `${body.trim()}\n\n${rendered}\n`.trim();

  const before = body.slice(0, m.index);
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(/^##\s+/m);
  const after = end === -1 ? "" : rest.slice(end);
  return `${before}${rendered}\n\n${after}`.trim();
}

/**
 * Merges an incoming document into an existing one.
 *
 * Union of facts, never replacement. Two searches can finish close together and each
 * propose an update to the same document; taking the newer whole-document wins would
 * silently discard whatever the other one learned. Memory here is additive by nature,
 * so union is both safer and more faithful than last-write-wins.
 */
export function mergeMemoryDocs(existing: MemoryDocument, incoming: MemoryDocument): MemoryDocument {
  const body = ["Summary", "Facts", "Open questions"].reduce((acc, heading) => {
    const a = sectionBullets(acc, heading);
    const b = sectionBullets(incoming.body, heading);

    if (heading === "Summary") {
      // Summary is prose, not bullets: the newer one replaces it outright.
      const incomingSummary = plainSection(incoming.body, "Summary");
      return incomingSummary ? setProse(acc, "Summary", incomingSummary) : acc;
    }
    const merged = dedupe([...a, ...b]);
    return merged.length ? setSection(acc, heading, merged) : acc;
  }, existing.body);

  return {
    frontmatter: {
      ...existing.frontmatter,
      title: incoming.frontmatter.title || existing.frontmatter.title,
      tags: dedupe([...existing.frontmatter.tags, ...incoming.frontmatter.tags]),
      updated: incoming.frontmatter.updated,
      confidence: Math.max(existing.frontmatter.confidence, incoming.frontmatter.confidence),
    },
    body,
  };
}

export function plainSection(body: string, heading: string): string {
  const re = new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`, "im");
  const m = re.exec(body);
  if (!m) return "";
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(/^##\s+/m);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

function setProse(body: string, heading: string, text: string): string {
  const rendered = `## ${heading}\n${text}`;
  const re = new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`, "im");
  const m = re.exec(body);
  if (!m) return `${body.trim()}\n\n${rendered}\n`.trim();
  const before = body.slice(0, m.index);
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(/^##\s+/m);
  const after = end === -1 ? "" : rest.slice(end);
  return `${before}${rendered}\n\n${after}`.trim();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    const key = i.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(i.trim());
  }
  return out;
}

function normalizeDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return new Date().toISOString();
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const yamlScalar = (s: string) => (/[:#\[\]{}]/.test(s) ? JSON.stringify(s) : s);

/** Drive filenames are flat, so nested paths are encoded with a separator. */
export const PATH_SEPARATOR = "__";
export const pathToFilename = (p: string) =>
  (p.endsWith(".md") ? p : `${p}.md`).replace(/\//g, PATH_SEPARATOR);
export const filenameToPath = (f: string) => f.split(PATH_SEPARATOR).join("/");
