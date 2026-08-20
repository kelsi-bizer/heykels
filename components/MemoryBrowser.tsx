"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DocIcon, PencilIcon, TrashIcon } from "./icons";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (list.length === 0) {
    return (
      <div className="empty">
        Nothing remembered yet. Run a few searches and HeyKels will start keeping notes
        here — one markdown file per topic, all of them yours to read, edit or delete.
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
    if (editingId === doc.id) setEditingId(null);
    await fetch(`/api/memory/${doc.id}`, { method: "DELETE" });
    router.refresh();
  };

  const startEdit = (doc: MemoryDocView) => {
    setEditingId(doc.id);
    setDraft(doc.body);
    setError(null);
    setOpen((prev) => new Set(prev).add(doc.id));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const saveEdit = async (doc: MemoryDocView) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory/${doc.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        body?: string;
        syncedAt?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(
          data.error === "conflict" || data.error === "drive_file_unreachable"
            ? "This file just changed elsewhere (a search may have updated it). Reload the page and try again."
            : data.error === "workspace_not_connected"
              ? "Google Workspace is disconnected — reconnect it on the Connections page to edit memory."
              : "Could not save. Try again.",
        );
        return;
      }
      setList((prev) =>
        prev.map((d) =>
          d.id === doc.id
            ? { ...d, body: data.body ?? draft, syncedAt: data.syncedAt ?? new Date().toISOString() }
            : d,
        ),
      );
      setEditingId(null);
      router.refresh();
    } catch {
      setError("Could not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
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
              aria-label={`Edit ${d.path}`}
              onClick={(e) => {
                e.stopPropagation();
                startEdit(d);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  startEdit(d);
                }
              }}
            >
              <PencilIcon />
            </span>
            <span
              role="button"
              tabIndex={0}
              className="kebab"
              style={{ opacity: 0.7, marginLeft: 4 }}
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
            {editingId === d.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={saving}
                  rows={Math.min(24, Math.max(8, draft.split("\n").length + 2))}
                  spellCheck={false}
                  aria-label={`Markdown for ${d.path}`}
                  style={{
                    width: "100%",
                    resize: "vertical",
                    font: "13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
                    color: "var(--text)",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}
                />
                {error && (
                  <div style={{ color: "var(--warn, #d96570)", fontSize: 13 }}>{error}</div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn s" disabled={saving} onClick={cancelEdit}>
                    Cancel
                  </button>
                  <button
                    className="btn p"
                    disabled={saving || !draft.trim()}
                    onClick={() => void saveEdit(d)}
                  >
                    {saving ? "Saving…" : "Save to Drive"}
                  </button>
                </div>
              </div>
            ) : (
              <pre>{d.body}</pre>
            )}
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
