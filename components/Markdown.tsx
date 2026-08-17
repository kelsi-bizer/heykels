"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SourceRef } from "@/lib/pipeline/events";

/**
 * Renders answer markdown, turning `[1]`-style markers into clickable citation chips.
 *
 * The model is instructed to emit numeric markers that index into the sources array,
 * which is itself built from Gemini's url_citation annotations — so the numbering is
 * anchored to real grounding metadata rather than to anything the model invented.
 */
export function Markdown({ text, sources = [] }: { text: string; sources?: SourceRef[] }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{citeify(children, sources)}</p>,
          li: ({ children }) => <li>{citeify(children, sources)}</li>,
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          a: ({ href, children }) => (
            <a className="linkish" href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const CITE = /\[(\d{1,2})\]/g;

function citeify(children: React.ReactNode, sources: SourceRef[]): React.ReactNode {
  return mapStrings(children, (str, keyBase) => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    CITE.lastIndex = 0;
    while ((m = CITE.exec(str)) !== null) {
      if (m.index > last) parts.push(str.slice(last, m.index));
      const n = Number(m[1]);
      const src = sources[n - 1];
      parts.push(
        src ? (
          <a
            key={`${keyBase}-${m.index}`}
            className="cite"
            href={src.url}
            target="_blank"
            rel="noreferrer noopener"
            title={src.title}
          >
            {n}
          </a>
        ) : (
          <span key={`${keyBase}-${m.index}`} className="cite">
            {n}
          </span>
        ),
      );
      last = m.index + m[0].length;
    }
    if (!parts.length) return str;
    if (last < str.length) parts.push(str.slice(last));
    return parts;
  });
}

/** Walks the rendered tree so citations inside bold/italic spans are still caught. */
function mapStrings(
  node: React.ReactNode,
  fn: (s: string, key: string) => React.ReactNode,
  key = "c",
): React.ReactNode {
  if (typeof node === "string") return fn(node, key);
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <span key={`${key}-${i}`} style={{ display: "contents" }}>
        {mapStrings(child, fn, `${key}-${i}`)}
      </span>
    ));
  }
  return node;
}
