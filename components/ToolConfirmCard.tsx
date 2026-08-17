"use client";

import { useState } from "react";
import { CheckIcon, WarnIcon, XIcon } from "./icons";
import type { ProposedTool } from "@/lib/pipeline/events";

export interface ToolDecision {
  callId: string;
  approved: boolean;
}

/**
 * Approval gate for write actions.
 *
 * Decisions are submitted as a batch because a single model turn can propose several
 * calls at once, and Gemini requires every function result from that turn to come
 * back together — "approve one, reject another" is only expressible as one payload.
 */
export function ToolConfirmCard({
  calls,
  onDecide,
  settled,
}: {
  calls: ProposedTool[];
  onDecide: (decisions: ToolDecision[]) => void;
  settled?: { approved: boolean; message: string };
}) {
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<Set<string>>(new Set());

  const decide = (approveAll: boolean) => {
    if (busy) return;
    setBusy(true);
    onDecide(
      calls.map((c) => ({
        callId: c.callId,
        approved: approveAll && !rejected.has(c.callId),
      })),
    );
  };

  const multi = calls.length > 1;

  return (
    <div
      className="tool"
      style={
        settled
          ? {
              borderColor: settled.approved
                ? "color-mix(in srgb,var(--ok) 45%,var(--border))"
                : "var(--border)",
              background: "transparent",
            }
          : undefined
      }
    >
      <div className="tool-h">
        <span style={{ color: "var(--warn)", display: "flex" }}>
          <WarnIcon />
        </span>
        {calls.length === 1
          ? "Approval needed"
          : `Approval needed · ${calls.length} actions`}
      </div>

      {calls.map((c) => (
        <div className="tool-b" key={c.callId}>
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            <code style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{c.toolName}</code>
            {multi && !settled && (
              <label style={{ marginLeft: 12, fontSize: 12.5, color: "var(--text-mute)" }}>
                <input
                  type="checkbox"
                  checked={rejected.has(c.callId)}
                  onChange={(e) => {
                    setRejected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(c.callId);
                      else next.delete(c.callId);
                      return next;
                    });
                  }}
                  style={{ marginRight: 6 }}
                />
                skip this one
              </label>
            )}
          </div>
          <dl className="kv">
            {Object.entries(c.args).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{typeof v === "string" ? v : JSON.stringify(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      {!settled && (
        <div className="tool-b" style={{ paddingTop: 0 }}>
          <div className="tool-a">
            <button className="btn p" disabled={busy} onClick={() => decide(true)}>
              {busy ? "Running…" : multi ? "Approve selected" : "Approve & run"}
            </button>
            <button className="btn s" disabled={busy} onClick={() => decide(false)}>
              Reject
            </button>
          </div>
        </div>
      )}

      {settled && (
        <div className="verdict">
          <span style={{ display: "flex", color: settled.approved ? "var(--ok)" : "var(--text-mute)" }}>
            {settled.approved ? <CheckIcon /> : <XIcon />}
          </span>
          <span style={{ color: settled.approved ? "var(--ok)" : "var(--text-mute)" }}>
            {settled.message}
          </span>
        </div>
      )}
    </div>
  );
}
