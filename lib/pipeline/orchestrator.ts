import { runWebLeg } from "./web-leg";
import { runMemoryLeg } from "./memory-leg";
import { buildSandbox, isEmpty, sandboxSources, type MemoryLeg, type WebLeg } from "./sandbox";
import { streamSynthesis, type PendingCall } from "./synthesis";
import { retrieve } from "@/lib/memory/retrieve";
import type { StreamEvent } from "./events";
import { getTool, toDeclaration, type WorkspaceTool } from "@/lib/workspace/registry";
import type { OAuth2Client } from "google-auth-library";

export interface OrchestratorDeps {
  userId: string;
  query: string;
  tools: WorkspaceTool[];
  /** Absent when the user has not connected Workspace; read tools then cannot run. */
  workspaceClient?: OAuth2Client | null;
  signal?: AbortSignal;
  emit: (e: StreamEvent) => void;
}

export interface OrchestratorResult {
  answer: string;
  sources: ReturnType<typeof sandboxSources>;
  sandboxJson: unknown;
  interactionId: string | null;
  pendingCalls: PendingCall[];
}

/** A leg that hangs shouldn't hold the whole answer hostage. */
const LEG_TIMEOUT_MS = Number(process.env.LEG_TIMEOUT_MS ?? 45_000);
const MAX_READ_HOPS = 5;

export async function runTurn(deps: OrchestratorDeps): Promise<OrchestratorResult> {
  const { userId, query, tools, workspaceClient, signal, emit } = deps;

  emit({ type: "stage_start", leg: "web" });
  emit({ type: "stage_start", leg: "memory" });

  const webPromise = withTimeout(
    runWebLeg(query, {
      signal,
      onLine: (line) => emit({ type: "stage_line", leg: "web", line }),
    }),
    LEG_TIMEOUT_MS,
    "web search timed out",
  );

  const memoryPromise = withTimeout(
    (async () => {
      const docs = await retrieve(userId, query);
      return runMemoryLeg(query, docs, {
        signal,
        onLine: (line) => emit({ type: "stage_line", leg: "memory", line }),
      });
    })(),
    LEG_TIMEOUT_MS,
    "memory search timed out",
  );

  // allSettled, never all: one leg failing must not discard the other's work. A 429
  // on the memory leg should still produce a grounded web answer, and vice versa.
  const [webSettled, memSettled] = await Promise.allSettled([webPromise, memoryPromise]);

  const web: WebLeg = unwrap(webSettled, "web search failed");
  const memory: MemoryLeg = unwrap(memSettled, "memory search failed");

  emit({
    type: "stage_done",
    leg: "web",
    status: web.ok ? "ok" : web.kind,
    detail: web.ok ? undefined : web.reason,
  });
  emit({
    type: "stage_done",
    leg: "memory",
    status: memory.ok ? "ok" : memory.kind,
    detail: memory.ok ? undefined : memory.reason,
  });

  const sandbox = buildSandbox(query, web, memory);

  if (isEmpty(sandbox)) {
    const reason = !web.ok ? web.reason : "both retrieval stages failed";
    emit({ type: "error", message: `Could not complete this search: ${reason}` });
    return {
      answer: "",
      sources: [],
      sandboxJson: sandbox,
      interactionId: null,
      pendingCalls: [],
    };
  }

  const sources = sandboxSources(sandbox);
  if (sources.length) emit({ type: "sources", sources });

  const declarations = tools.map(toDeclaration);

  let result = await streamSynthesis(
    sandbox,
    declarations,
    (text) => emit({ type: "text_delta", text }),
    { signal },
  );
  let answer = result.text;

  // Read-only calls execute inline and loop, bounded. Anything requiring confirmation
  // stops the loop: the stream ends and the decision comes back on a new request.
  for (let hop = 0; hop < MAX_READ_HOPS; hop++) {
    if (result.calls.length === 0) break;

    const needsApproval = result.calls.filter((c) => getTool(c.name)?.requiresConfirmation ?? true);
    if (needsApproval.length > 0) {
      return {
        answer,
        sources,
        sandboxJson: sandbox,
        interactionId: result.interactionId,
        pendingCalls: result.calls,
      };
    }

    const { streamContinuation } = await import("./synthesis");
    const results = [];
    for (const call of result.calls) {
      const tool = getTool(call.name);
      let resultText: string;
      let ok = true;
      if (!tool) {
        resultText = JSON.stringify({ error: `unknown tool ${call.name}` });
        ok = false;
      } else if (!workspaceClient) {
        resultText = JSON.stringify({ error: "Google Workspace is not connected." });
        ok = false;
      } else {
        try {
          resultText = JSON.stringify(await tool.execute(workspaceClient, call.args));
        } catch (err) {
          resultText = JSON.stringify({ error: (err as Error).message });
          ok = false;
        }
      }
      emit({
        type: "tool_result",
        toolName: call.name,
        ok,
        summary: tool ? tool.summarize(call.args) : call.name,
      });
      results.push({ callId: call.callId, name: call.name, resultText });
    }

    if (!result.interactionId) break;
    result = await streamContinuation(
      result.interactionId,
      results,
      declarations,
      (text) => emit({ type: "text_delta", text }),
      { signal },
    );
    answer += result.text;
  }

  return {
    answer,
    sources,
    sandboxJson: sandbox,
    interactionId: result.interactionId,
    pendingCalls: [],
  };
}

function unwrap<T extends { ok: boolean }>(
  settled: PromiseSettledResult<T>,
  fallback: string,
): T | { ok: false; reason: string; kind: "degraded" } {
  if (settled.status === "fulfilled") return settled.value;
  const reason = (settled.reason as Error)?.message ?? fallback;
  return { ok: false, reason, kind: "degraded" };
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
