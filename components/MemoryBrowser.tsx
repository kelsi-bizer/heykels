"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DocIcon, TrashIcon } from "./icons";

export interface MemoryDocView {
  id: string;
  path: string;
  title: string;
  tags: string[];
  body: string;
  syncedAt: string;
}

export function MemoryBrowser({ docs }: { docs: MemoryDocView[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [list, setList] = useState(docs);
  const router = useRouter();

  if (list.length === 0) {
    return (
      <div className="empty">
        Nothing remembered yet. Run a few searches and HeyKels will start keeping notes
        here — one markdown file per topic, all of them yours to read or delete.
      </div>
    );
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const forget = async (doc: MemoryDocView) => {
    setList((prev) => prev.filter((d) => d.id !== doc.id));
    await fetch(`/api/memory/${doc.id}`, { method: "DELETE" });
    router.refresh();
  };

  return (
    <>
      {list.map((d) => (
        <div className={`doc${open.has(d.id) ? " open" : ""}`} key={d.id}>
          <button className="doc-h" onClick={() => toggle(d.id)} aria-expanded={open.has(d.id)}>
            <span style={{ color: "var(--g2)", display: "flex", flex: "0 0 17px" }}>
              <DocIcon size={17} />
            </span>
            <span className="doc-p">{d.path}</span>
            {d.tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
            <span className="doc-m">{relative(d.syncedAt)}</span>
            <span
              role="button"
              tabIndex={0}
              className="kebab"
              style={{ opacity: 0.7, marginLeft: 8 }}
              aria-label={`Forget ${d.path}`}
              onClick={(e) => {
                e.stopPropagation();
                void forget(d);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  void forget(d);
                }
              }}
            >
              <TrashIcon />
            </span>
          </button>
          <div className="doc-b">
            <pre>{d.body}</pre>
          </div>
        </div>
      ))}
    </>
  );
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
