"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "./icons";

type ImportResult = {
  files: { name: string; kind: string; conversations: number; conversationsUsed: number; error?: string }[];
  chunksProcessed: number;
  paths: string[];
  error?: string;
};

/**
 * The import surface: a hand-written note, or a data export from another
 * assistant distilled into memory. Both end up as the same markdown documents
 * in Drive as everything HeyKels learns on its own.
 */
export function MemoryActions({ connected }: { connected: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"note" | "import" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disabledNote = !connected
    ? "Connect Google Workspace first — memory lives in your Drive."
    : null;

  const saveNote = async () => {
    if (!title.trim() || !body.trim() || busy) return;
    setBusy("note");
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const data = (await res.json()) as { path?: string; error?: string };
      if (!res.ok) {
        setError(data.error === "workspace_not_connected" ? disabledNote ?? "Not connected." : "Could not save the note.");
        return;
      }
      setStatus(`Saved to ${data.path}`);
      setTitle("");
      setBody("");
      setNoteOpen(false);
      router.refresh();
    } catch {
      setError("Could not save the note. Check your connection.");
    } finally {
      setBusy(null);
    }
  };

  const runImport = async (files: FileList | null) => {
    if (!files?.length || busy) return;
    setBusy("import");
    setError(null);
    setStatus("Importing… reading your export and distilling it into memory. This can take a minute or two.");
    try {
      const form = new FormData();
      for (const f of Array.from(files).slice(0, 5)) form.append("files", f);
      const res = await fetch("/api/memory/import", { method: "POST", body: form });
      const data = (await res.json()) as ImportResult;
      if (!res.ok) {
        setStatus(null);
        setError(
          data.error === "workspace_not_connected"
            ? disabledNote ?? "Not connected."
            : `Import failed: ${data.error ?? res.status}`,
        );
        return;
      }
      const convs = data.files.reduce((n, f) => n + f.conversations, 0);
      const used = data.files.reduce((n, f) => n + f.conversationsUsed, 0);
      const bad = data.files.filter((f) => f.error);
      const parts = [
        `Read ${used}${used < convs ? ` of ${convs}` : ""} conversation${convs === 1 ? "" : "s"}`,
        data.paths.length
          ? `updated ${data.paths.length} memory document${data.paths.length === 1 ? "" : "s"}`
          : "found nothing durable to keep",
      ];
      if (used < convs) parts.push("older conversations were skipped — import again to continue");
      if (bad.length) parts.push(`${bad.length} file${bad.length === 1 ? "" : "s"} unreadable (${bad[0].error})`);
      setStatus(parts.join(" · "));
      router.refresh();
    } catch {
      setStatus(null);
      setError("Import failed. Check your connection and try again.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const dashBtn: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "14px 18px",
    border: "1.5px dashed var(--border)",
    borderRadius: 14,
    color: "var(--text)",
    fontSize: 14.5,
    fontWeight: 500,
    background: "none",
    cursor: connected ? "pointer" : "not-allowed",
    opacity: connected ? 1 : 0.55,
    transition: "background .15s,border-color .15s",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: "6px 0 22px" }}>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,.json,.txt,.md"
        multiple
        hidden
        onChange={(e) => void runImport(e.target.files)}
      />

      <button
        className="dash"
        style={dashBtn}
        disabled={!connected || busy !== null}
        title={disabledNote ?? undefined}
        onClick={() => setNoteOpen((o) => !o)}
      >
        <PlusIcon size={16} /> New note
      </button>

      {noteOpen && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 14,
            border: "1px solid var(--border)",
            borderRadius: 14,
            background: "var(--surface)",
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title — e.g. Ava's allergies"
            maxLength={80}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "10px 12px",
              color: "var(--text)",
              font: "inherit",
              fontSize: 14,
            }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Anything HeyKels should always know. Markdown welcome."
            rows={5}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "10px 12px",
              color: "var(--text)",
              font: "13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn s" disabled={busy !== null} onClick={() => setNoteOpen(false)}>
              Cancel
            </button>
            <button
              className="btn p"
              disabled={busy !== null || !title.trim() || !body.trim()}
              onClick={() => void saveNote()}
            >
              {busy === "note" ? "Saving…" : "Save note"}
            </button>
          </div>
        </div>
      )}

      <button
        className="dash"
        style={dashBtn}
        disabled={!connected || busy !== null}
        title={disabledNote ?? undefined}
        onClick={() => fileRef.current?.click()}
      >
        ⬆ Import from ChatGPT or Claude
      </button>
      <p style={{ fontSize: 12.5, color: "var(--text-mute)", margin: "-4px 4px 0" }}>
        Upload the .zip from a ChatGPT or Claude data export (up to 5 at once), a bare
        conversations.json, or your memory pasted into a .txt/.md file. HeyKels reads only
        what <em>you</em> wrote and distills the durable facts — people, projects,
        preferences — into markdown memory in your Drive. Nothing is imported verbatim.
      </p>

      {busy === "import" && status && (
        <div className="mem-pill">{status}</div>
      )}
      {busy !== "import" && status && <div className="mem-pill">✓ {status}</div>}
      {error && <div className="err">{error}</div>}
    </div>
  );
}
