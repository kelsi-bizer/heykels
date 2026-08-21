import { after } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { encodeEvent, type ProposedTool, type StreamEvent } from "@/lib/pipeline/events";
import { runTurn } from "@/lib/pipeline/orchestrator";
import { getWorkspaceContext } from "@/lib/google/tokens";
import { availableTools } from "@/lib/workspace/tools";
import { getTool } from "@/lib/workspace/registry";
import { writeMemoryFromTurn } from "@/lib/memory/writer";

// Streaming needs the Node runtime; force-dynamic keeps this out of any cache; and
// no-transform plus X-Accel-Buffering stop proxies from buffering the whole body,
// which is the difference between a live stream and one long pause.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
/** ~4MB of base64 ≈ 3MB image — far above what the client's downscale produces. */
const MAX_IMAGE_B64 = 4_000_000;

function validateImage(
  image?: { data?: string; mime?: string },
): { data: string; mime: string } | null {
  if (!image?.data || !image.mime) return null;
  if (!IMAGE_MIMES.has(image.mime)) return null;
  if (image.data.length > MAX_IMAGE_B64) return null;
  // Sanity: base64, not a data: URL and not raw bytes.
  if (!/^[A-Za-z0-9+/=]+$/.test(image.data.slice(0, 100))) return null;
  return { data: image.data, mime: image.mime };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("unauthenticated", { status: 401 });

  const { id: searchId } = await params;
  const { query, image } = (await req.json()) as {
    query?: string;
    image?: { data?: string; mime?: string };
  };

  // A photo with no words is a legitimate turn ("here's the school calendar" is
  // implied); text-only turns still require text.
  const attachment = validateImage(image);
  if (image && !attachment) return new Response("invalid image", { status: 400 });
  if (!query?.trim() && !attachment) return new Response("query required", { status: 400 });
  const queryText = query?.trim() || "(photo attached)";

  const userId = session.user.id;
  const search = await prisma.search.findFirst({ where: { id: searchId, userId } });
  if (!search) return new Response("not found", { status: 404 });

  const turn = await prisma.turn.create({
    data: {
      searchId,
      query: queryText,
      imageData: attachment?.data ?? null,
      imageMime: attachment?.mime ?? null,
    },
    select: { id: true },
  });

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

      emit({ type: "turn_created", turnId: turn.id });

      try {
        const ws = await getWorkspaceContext(userId);
        const tools = availableTools(ws?.grantedScopes ?? []);

        const result = await runTurn({
          userId,
          query: queryText,
          tools,
          workspaceClient: ws?.client ?? null,
          attachment,
          signal: req.signal,
          emit,
        });

        if (result.pendingCalls.length > 0) {
          // The stream ends here rather than blocking: an HTTP response cannot wait
          // on a second request. State lives in Postgres so the decision survives a
          // page refresh, and the resume opens a fresh stream.
          await prisma.pendingToolCall.createMany({
            data: result.pendingCalls.map((c) => ({
              turnId: turn.id,
              callId: c.callId,
              toolName: c.name,
              args: c.args as object,
              interactionId: result.interactionId ?? "",
              thoughtSignature: c.thoughtSignature ?? null,
            })),
            skipDuplicates: true,
          });

          const proposed: ProposedTool[] = result.pendingCalls.map((c) => ({
            callId: c.callId,
            toolName: c.name,
            args: c.args,
            summary: getTool(c.name)?.summarize(c.args) ?? c.name,
          }));

          await prisma.turn.update({
            where: { id: turn.id },
            data: {
              answer: result.answer,
              sources: result.sources as object,
              sandboxJson: result.sandboxJson as object,
              interactionId: result.interactionId,
              status: "awaiting_approval",
            },
          });

          emit({ type: "tool_proposed", calls: proposed });
          emit({ type: "done", turnId: turn.id });
          controller.close();
          closed = true;
          return;
        }

        await prisma.turn.update({
          where: { id: turn.id },
          data: {
            answer: result.answer,
            sources: result.sources as object,
            sandboxJson: result.sandboxJson as object,
            interactionId: result.interactionId,
            status: result.answer ? "complete" : "error",
          },
        });
        await prisma.search.update({
          where: { id: searchId },
          data: { updatedAt: new Date() },
        });

        // Memory is written after the answer, never blocking it. `after()` is required:
        // a bare floating promise is killed when the serverless response closes, and
        // the write would silently never happen.
        if (result.answer && ws) {
          // A transcribed document is the richest thing this turn learned — hand it
          // to the writer alongside the answer so the sheet itself lands in memory.
          const learned = result.documentMarkdown
            ? `${result.answer}\n\n--- Transcribed from the user's photo ---\n${result.documentMarkdown}`
            : result.answer;
          after(async () => {
            try {
              const paths = await writeMemoryFromTurn(userId, queryText, learned);
              if (paths.length) {
                // The stream is gone by now; the UI picks this up on refresh.
                await prisma.turn.update({
                  where: { id: turn.id },
                  data: { status: "complete" },
                });
              }
            } catch {
              // A memory-write failure must never surface as a failed search.
            }
          });
        }

        emit({ type: "done", turnId: turn.id });
      } catch (err) {
        const aborted = (err as Error)?.name === "AbortError";
        if (!aborted) console.error("[heykels] turn failed:", err);
        const message = aborted
          ? "Search cancelled."
          : ((err as Error)?.message ?? "Something went wrong.");
        emit({ type: "error", message });
        await prisma.turn
          .update({ where: { id: turn.id }, data: { status: "error" } })
          .catch(() => {});
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
      connection: "keep-alive",
    },
  });
}
