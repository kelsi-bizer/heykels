import { MODELS, genai, withRetry } from "./client";
import { SYNTHESIS_INSTRUCTION, renderSandbox, type Sandbox } from "./sandbox";

export interface PendingCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface SynthesisResult {
  interactionId: string | null;
  text: string;
  calls: PendingCall[];
}

export interface FunctionResultInput {
  callId: string;
  name: string;
  resultText: string;
}

interface ToolDeclaration {
  type: "function";
  name: string;
  description: string;
  parameters: unknown;
}

/**
 * Leg C: synthesis.
 *
 * Note what is NOT here: google_search. Leg A already grounded the answer, and mixing
 * a built-in tool with custom function declarations in one request is a preview-only
 * capability that requires round-tripping encrypted thought signatures. Keeping the
 * search in leg A means this stage stays on generally-available behaviour.
 *
 * Config is assembled in one place because `tools`, `system_instruction` and
 * `generation_config` are interaction-scoped: `previous_interaction_id` carries the
 * conversation history but none of the configuration, so every continuation must
 * resend it. Building it twice is how the initial call and the resume drift apart.
 */
function baseConfig(tools: ToolDeclaration[]) {
  return {
    model: MODELS.synth(),
    system_instruction: SYNTHESIS_INSTRUCTION,
    tools,
    // Must stay true, or previous_interaction_id has nothing to continue from.
    store: true,
    stream: true as const,
  };
}

export async function streamSynthesis(
  sandbox: Sandbox,
  tools: ToolDeclaration[],
  onDelta: (text: string) => void,
  { signal }: { signal?: AbortSignal } = {},
): Promise<SynthesisResult> {
  const stream = await withRetry(
    () =>
      genai().interactions.create({
        ...baseConfig(tools),
        input: renderSandbox(sandbox),
      } as never),
    { signal },
  );
  return consume(stream as unknown as AsyncIterable<unknown>, onDelta, signal);
}

/** Continues an interaction after tools ran, resending the same interaction-scoped config. */
export async function streamContinuation(
  previousInteractionId: string,
  results: FunctionResultInput[],
  tools: ToolDeclaration[],
  onDelta: (text: string) => void,
  { signal }: { signal?: AbortSignal } = {},
): Promise<SynthesisResult> {
  const stream = await withRetry(
    () =>
      genai().interactions.create({
        ...baseConfig(tools),
        previous_interaction_id: previousInteractionId,
        input: results.map((r) => ({
          type: "function_result",
          name: r.name,
          call_id: r.callId,
          result: { content: [{ type: "text", text: r.resultText }] },
        })),
      } as never),
    { signal },
  );
  return consume(stream as unknown as AsyncIterable<unknown>, onDelta, signal);
}

interface DeltaEvent {
  event_type?: string;
  delta?: { type?: string; text?: string; arguments?: string };
  interaction?: { id?: string };
  step?: { id?: string; type?: string; name?: string; call_id?: string; thought_signature?: string };
  error?: { message?: string };
}

async function consume(
  stream: AsyncIterable<unknown>,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<SynthesisResult> {
  let interactionId: string | null = null;
  let text = "";
  const calls: PendingCall[] = [];

  // Function-call arguments arrive as JSON string fragments across step.delta events;
  // step.arguments is not populated during streaming, so they must be accumulated
  // per step and parsed once the step stops.
  const argBuf = new Map<string, string>();
  const meta = new Map<string, { name: string; callId: string; signature?: string }>();

  for await (const raw of stream) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const e = raw as DeltaEvent;

    switch (e.event_type) {
      case "interaction.created":
        // The id is available here, at the start — not at completion. Capturing it
        // late means an interrupted stream has nothing to resume from.
        interactionId = e.interaction?.id ?? interactionId;
        break;

      case "step.start":
        if (e.step?.type === "function_call" && e.step.id) {
          meta.set(e.step.id, {
            name: e.step.name ?? "",
            callId: e.step.call_id ?? e.step.id,
            signature: e.step.thought_signature,
          });
          argBuf.set(e.step.id, "");
        }
        break;

      case "step.delta": {
        if (e.delta?.type === "text" && e.delta.text) {
          text += e.delta.text;
          onDelta(e.delta.text);
        } else if (e.delta?.type === "function_call" && typeof e.delta.arguments === "string") {
          const id = e.step?.id ?? "";
          argBuf.set(id, (argBuf.get(id) ?? "") + e.delta.arguments);
        }
        break;
      }

      case "step.stop": {
        const id = e.step?.id ?? "";
        const m = meta.get(id);
        if (m) {
          calls.push({
            callId: m.callId,
            name: m.name || e.step?.name || "",
            args: safeParse(argBuf.get(id) ?? ""),
            thoughtSignature: m.signature ?? e.step?.thought_signature,
          });
          meta.delete(id);
          argBuf.delete(id);
        }
        break;
      }

      case "error":
        throw new Error(e.error?.message ?? "model stream error");
    }
  }

  return { interactionId, text, calls };
}

function safeParse(s: string): Record<string, unknown> {
  if (!s.trim()) return {};
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
