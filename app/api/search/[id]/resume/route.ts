import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encodeEvent, type StreamEvent } from "@/lib/pipeline/events";
import { streamContinuation, type FunctionResultInput } from "@/lib/pipeline/synthesis";
import { getWorkspaceContext } from "@/lib/google/tokens";
import { availableTools } from "@/lib/workspace/tools";
import { getTool, toDeclaration } from "@/lib/workspace/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Decision {
  callId: string;
  approved: boolean;
}

/**
 * Second half of the approval handoff.
 *
 * Decisions arrive as a batch because a single model turn can propose several calls,
 * and Gemini requires every function result from that turn to come back in one input
 * array — "approve this, reject that" is not expressible one call at a time.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("unauthenticated", { status: 401 });

  const { id: searchId } = await params;
  const { turnId, decisions } = (await req.json()) as {
    turnId?: string;
    decisions?: Decision[];
  };
  if (!turnId || !Array.isArray(decisions)) {
    return new Response("turnId and decisions required", { status: 400 });
  }

  const userId = session.user.id;
  const turn = await prisma.turn.findFirst({
    where: { id: turnId, search: { id: searchId, userId } },
    include: { pending: true },
  });
  if (!turn) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(e)));
        } catch {
          closed = true;
        }
      };

      try {
        const ws = await getWorkspaceContext(userId);
        const tools = availableTools(ws?.grantedScopes ?? []);
        const decisionFor = new Map(decisions.map((d) => [d.callId, d.approved]));

        const results: FunctionResultInput[] = [];

        for (const call of turn.pending) {
          if (call.status !== "pending") continue;
          const approved = decisionFor.get(call.callId) ?? false;
          const tool = getTool(call.toolName);

          if (!approved) {
            // A rejection must still produce a function_result. Omitting it leaves the
            // interaction parked at requires_action forever, which poisons every later
            // turn in the thread — the model would never respond again.
            results.push({
              callId: call.callId,
              name: call.toolName,
              resultText: JSON.stringify({
                error: "user_declined",
                message: "The user declined this action. Do not retry it.",
              }),
            });
            await prisma.pendingToolCall.update({
              where: { id: call.id },
              data: { status: "rejected" },
            });
            continue;
          }

          let payload: unknown;
          let status = "executed";
          try {
            if (!tool) throw new Error(`Unknown tool ${call.toolName}`);
            if (!ws) throw new Error("Google Workspace is not connected.");
            payload = await tool.execute(ws.client, call.args as Record<string, unknown>);
          } catch (err) {
            payload = { error: (err as Error).message };
            status = "failed";
          }

          emit({
            type: "tool_result",
            toolName: call.toolName,
            ok: status === "executed",
            summary: tool ? tool.summarize(call.args as Record<string, unknown>) : call.toolName,
          });

          results.push({
            callId: call.callId,
            name: call.toolName,
            resultText: JSON.stringify(payload),
          });
          await prisma.pendingToolCall.update({
            where: { id: call.id },
            data: { status, result: payload as object },
          });
        }

        if (!turn.interactionId) {
          emit({ type: "error", message: "This turn can no longer be continued." });
          emit({ type: "done", turnId: turn.id });
          controller.close();
          closed = true;
          return;
        }

        let text = "";
        const result = await streamContinuation(
          turn.interactionId,
          results,
          tools.map(toDeclaration),
          (delta) => {
            text += delta;
            emit({ type: "text_delta", text: delta });
          },
          { signal: req.signal },
        );

        await prisma.turn.update({
          where: { id: turn.id },
          data: {
            answer: `${turn.answer}${turn.answer && text ? "\n\n" : ""}${text}`,
            interactionId: result.interactionId ?? turn.interactionId,
            status: "complete",
          },
        });

        emit({ type: "done", turnId: turn.id });
      } catch (err) {
        console.error("[heykels] resume failed:", err);
        emit({
          type: "error",
          message: (err as Error)?.message ?? "Could not complete the action.",
        });
      } finally {
        if (!closed) {
          controller.close();
          closed = true;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
