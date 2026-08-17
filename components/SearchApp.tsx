"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "./Markdown";
import { ProcessPanel, type LegState } from "./ProcessPanel";
import { ToolConfirmCard, type ToolDecision } from "./ToolConfirmCard";
import { CopyIcon, SendIcon, Sparkle, ThumbDownIcon, ThumbUpIcon } from "./icons";
import { NdjsonParser, type ProposedTool, type SourceRef, type StreamEvent } from "@/lib/pipeline/events";

export interface InitialTurn {
  id: string;
  query: string;
  answer: string;
  sources: SourceRef[];
}

interface TurnState {
  id: string;
  query: string;
  answer: string;
  sources: SourceRef[];
  web: LegState;
  memory: LegState;
  merged: boolean;
  streaming: boolean;
  pending: ProposedTool[] | null;
  settled?: { approved: boolean; message: string };
  toolResults: { toolName: string; ok: boolean; summary: string }[];
  memoryUpdated: string[];
  error?: string;
}

const idleLeg = (): LegState => ({ status: "idle", lines: [] });

const CHIPS = [
  "What's new in AI-native search this month?",
  "Draft an email to the team about our launch",
  "Summarize my notes on the HeyKels architecture",
  "Find a time next week for a design review",
];

export function SearchApp({
  searchId,
  initialTurns,
  firstName,
}: {
  searchId: string | null;
  initialTurns: InitialTurn[];
  firstName: string;
}) {
  const router = useRouter();
  const [sid, setSid] = useState(searchId);
  const [turns, setTurns] = useState<TurnState[]>(() =>
    initialTurns.map((t) => ({
      ...t,
      web: { status: "ok", lines: [] },
      memory: { status: "ok", lines: [] },
      merged: true,
      streaming: false,
      pending: null,
      toolResults: [],
      memoryUpdated: [],
    })),
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abandoning a search should stop the upstream model call, not just hide it.
  useEffect(() => () => abortRef.current?.abort(), []);

  const toBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const patch = useCallback((idx: number, fn: (t: TurnState) => TurnState) => {
    setTurns((prev) => prev.map((t, i) => (i === idx ? fn(t) : t)));
  }, []);

  /** Consumes an NDJSON stream into the turn at `idx`. */
  const consume = useCallback(
    async (res: Response, idx: number) => {
      if (!res.ok || !res.body) {
        patch(idx, (t) => ({ ...t, streaming: false, error: `Request failed (${res.status})` }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = new NdjsonParser();

      const apply = (e: StreamEvent) => {
        switch (e.type) {
          case "turn_created":
            patch(idx, (t) => ({ ...t, id: e.turnId }));
            break;
          case "stage_start":
            patch(idx, (t) => ({ ...t, [e.leg]: { status: "running", lines: [] } }) as TurnState);
            break;
          case "stage_line":
            patch(idx, (t) => {
              const leg = t[e.leg];
              return { ...t, [e.leg]: { ...leg, lines: [...leg.lines, e.line] } } as TurnState;
            });
            break;
          case "stage_done":
            patch(idx, (t) => {
              const leg = t[e.leg];
              const next = { ...t, [e.leg]: { ...leg, status: e.status, detail: e.detail } } as TurnState;
              next.merged = next.web.status !== "running" && next.memory.status !== "running";
              return next;
            });
            break;
          case "sources":
            patch(idx, (t) => ({ ...t, sources: e.sources }));
            break;
          case "text_delta":
            patch(idx, (t) => ({ ...t, answer: t.answer + e.text }));
            break;
          case "tool_result":
            patch(idx, (t) => ({ ...t, toolResults: [...t.toolResults, e] }));
            break;
          case "tool_proposed":
            patch(idx, (t) => ({ ...t, pending: e.calls, streaming: false }));
            break;
          case "memory_updated":
            patch(idx, (t) => ({ ...t, memoryUpdated: e.paths }));
            break;
          case "done":
            patch(idx, (t) => ({ ...t, streaming: false }));
            break;
          case "error":
            patch(idx, (t) => ({ ...t, streaming: false, error: e.message }));
            break;
        }
        toBottom();
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const e of parser.push(decoder.decode(value, { stream: true }))) apply(e);
      }
      for (const e of parser.flush()) apply(e);
    },
    [patch, toBottom],
  );

  const ask = useCallback(
    async (query: string) => {
      if (!query.trim() || busy) return;
      setBusy(true);
      setInput("");

      const idx = turns.length;
      setTurns((prev) => [
        ...prev,
        {
          id: `pending-${idx}`,
          query,
          answer: "",
          sources: [],
          web: idleLeg(),
          memory: idleLeg(),
          merged: false,
          streaming: true,
          pending: null,
          toolResults: [],
          memoryUpdated: [],
        },
      ]);
      requestAnimationFrame(toBottom);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        let id = sid;
        if (!id) {
          const created = await fetch("/api/searches", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: query }),
            signal: controller.signal,
          });
          if (!created.ok) throw new Error("Could not start a new search");
          id = ((await created.json()) as { id: string }).id;
          setSid(id);
          // Update the URL without remounting — a router navigation here would
          // tear down the component mid-stream and drop the response.
          window.history.replaceState(null, "", `/search/${id}`);
        }

        const res = await fetch(`/api/search/${id}/turn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });
        await consume(res, idx);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patch(idx, (t) => ({ ...t, streaming: false, error: (err as Error).message }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
        router.refresh();
      }
    },
    [busy, consume, patch, router, sid, toBottom, turns.length],
  );

  const decide = useCallback(
    async (idx: number, decisions: ToolDecision[]) => {
      const turn = turns[idx];
      if (!turn || !sid) return;
      const anyApproved = decisions.some((d) => d.approved);
      patch(idx, (t) => ({ ...t, pending: null, streaming: true }));

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search/${sid}/resume`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ turnId: turn.id, decisions }),
          signal: controller.signal,
        });
        patch(idx, (t) => ({
          ...t,
          settled: {
            approved: anyApproved,
            message: anyApproved ? "Action approved and run." : "Rejected — nothing was changed.",
          },
        }));
        await consume(res, idx);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patch(idx, (t) => ({ ...t, streaming: false, error: (err as Error).message }));
        }
      } finally {
        abortRef.current = null;
        router.refresh();
      }
    },
    [consume, patch, router, sid, turns],
  );

  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  };

  return (
    <>
      <div className="scroll" ref={scrollRef}>
        <div className="wrap">
          {turns.length === 0 && (
            <div className="hero">
              <h1 className="hello">
                <span className="grad">Hello, {firstName}</span>
                <span className="sub">What are we looking into?</span>
              </h1>
              <div className="chips">
                {CHIPS.map((c) => (
                  <button key={c} className="chip" onClick={() => void ask(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => (
            <div className="turn" key={t.id}>
              <div className="q">
                <div className="txt">{t.query}</div>
              </div>
              <div className="a">
                <Sparkle spinning={t.streaming} />
                <div className="a-body">
                  {(t.web.status !== "idle" || t.memory.status !== "idle") && (
                    <ProcessPanel
                      web={t.web}
                      memory={t.memory}
                      merged={t.merged}
                      defaultOpen={t.streaming && !t.merged}
                    />
                  )}

                  {t.toolResults.map((r, k) => (
                    <div className="mem-pill" key={k} style={{ marginBottom: 10 }}>
                      {r.ok ? "✓" : "✗"} {r.summary}
                    </div>
                  ))}

                  {t.answer && <Markdown text={t.answer} sources={t.sources} />}
                  {t.streaming && !t.answer && !t.merged && null}

                  {t.error && <div className="err">{t.error}</div>}

                  {t.sources.length > 0 && (
                    <div className="srcs">
                      {t.sources.map((s, k) => (
                        <a
                          className="src"
                          key={k}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <span
                            className="fav"
                            style={{ background: s.memoryPath ? "var(--g2)" : "var(--g1)" }}
                          >
                            {s.memoryPath ? "M" : hostInitial(s.url)}
                          </span>
                          <span className="n">{s.title}</span>
                          <span style={{ color: "var(--text-mute)" }}>{k + 1}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  {t.pending && (
                    <ToolConfirmCard calls={t.pending} onDecide={(d) => void decide(i, d)} />
                  )}
                  {t.settled && !t.pending && (
                    <ToolConfirmCard calls={[]} onDecide={() => {}} settled={t.settled} />
                  )}

                  {t.memoryUpdated.length > 0 && (
                    <div className="mem-pill">
                      Memory updated ·{" "}
                      <code style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
                        {t.memoryUpdated.join(", ")}
                      </code>
                    </div>
                  )}

                  {!t.streaming && t.answer && (
                    <div className="acts">
                      <button className="act" title="Good answer"><ThumbUpIcon /></button>
                      <button className="act" title="Bad answer"><ThumbDownIcon /></button>
                      <button
                        className="act"
                        title="Copy"
                        onClick={() => void navigator.clipboard?.writeText(t.answer)}
                      >
                        <CopyIcon />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="composer-dock">
        <div className="composer">
          <textarea
            ref={taRef}
            rows={1}
            placeholder="Ask HeyKels"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
          />
          <button
            className={`send${input.trim() ? " on" : ""}`}
            onClick={() => void ask(input)}
            aria-label="Send"
            disabled={busy}
          >
            <SendIcon />
          </button>
        </div>
        <div className="foot-note">
          Two searches run in parallel — the live web and your own memory — then merge into one answer.
        </div>
      </div>
    </>
  );
}

function hostInitial(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").charAt(0).toUpperCase();
  } catch {
    return "?";
  }
}
