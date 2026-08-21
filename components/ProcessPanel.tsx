"use client";

import { useState } from "react";
import { CaretIcon, InfoIcon } from "./icons";
import type { LegStatus } from "@/lib/pipeline/events";

export interface LegState {
  status: "idle" | "running" | LegStatus;
  lines: string[];
  detail?: string;
}

const DOT: Record<LegState["status"], string> = {
  idle: "dot",
  running: "dot run",
  ok: "dot done",
  degraded: "dot skip",
  skipped: "dot skip",
};

/**
 * Shows both retrieval legs running side by side, then merging.
 *
 * This is the product's whole thesis made visible: the two searches really do run
 * concurrently, so the panel defaults to open while they work rather than hiding
 * behind a "show thinking" affordance.
 */
export function ProcessPanel({
  web,
  memory,
  document: doc,
  merged,
  defaultOpen,
}: {
  web: LegState;
  memory: LegState;
  /** Replaces the web leg on turns that carried a photo. */
  document?: LegState;
  merged: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasDoc = doc ? doc.status !== "idle" : false;

  const label = merged
    ? "Merged 2 sources of context"
    : hasDoc
      ? "Reading your photo and checking memory…"
      : "Running two searches in parallel…";

  return (
    <div className={`proc${open ? " open" : ""}`}>
      <button className="proc-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <InfoIcon />
        <span className="lbl">{label}</span>
        <CaretIcon className="caret" />
      </button>
      <div className="proc-body">
        <div className="legs">
          {hasDoc && doc ? (
            <Leg title="Leg A · your photo" state={doc} />
          ) : (
            <Leg title="Leg A · web" state={web} />
          )}
          <Leg title="Leg B · your memory" state={memory} />
        </div>
        <div className="merge">
          <span className="bar" />
          merge
          <span className="bar" />
        </div>
        <div className="sandbox">
          {merged ? "sandbox — both legs in, synthesizing" : "sandbox — waiting for both legs"}
        </div>
      </div>
    </div>
  );
}

function Leg({ title, state }: { title: string; state: LegState }) {
  return (
    <div className="leg">
      <div className="leg-t">
        <span className={DOT[state.status]} />
        {title}
      </div>
      <div className="leg-out">
        {state.lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        {state.detail && <div style={{ color: "var(--warn)" }}>{state.detail}</div>}
      </div>
    </div>
  );
}
