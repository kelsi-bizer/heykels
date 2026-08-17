import type { OAuth2Client } from "google-auth-library";

/**
 * A Workspace capability the agent can invoke.
 *
 * `requiresConfirmation` is the safety boundary of the whole product: anything that
 * changes state in the user's account must be true, and the orchestrator refuses to
 * auto-execute those. Read-only tools run inline so a calendar lookup doesn't cost a
 * round trip through the UI.
 */
export interface WorkspaceTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  requiresConfirmation: boolean;
  /** Scope group from lib/google/scopes.ts, used to explain a missing grant. */
  scopeGroup: "gmail" | "calendar" | "drive" | "docs" | "sheets";
  /** One-line description of a specific invocation, shown on the confirmation card. */
  summarize: (args: Record<string, unknown>) => string;
  execute: (client: OAuth2Client, args: Record<string, unknown>) => Promise<unknown>;
}

const registry = new Map<string, WorkspaceTool>();

export function registerTools(tools: WorkspaceTool[]): void {
  for (const t of tools) registry.set(t.name, t);
}

export function getTool(name: string): WorkspaceTool | undefined {
  return registry.get(name);
}

export function allTools(): WorkspaceTool[] {
  return [...registry.values()];
}

/** Only the tools whose scopes the user has actually granted. */
export function toolsForScopes(granted: string[], scopeFor: (g: string) => string): WorkspaceTool[] {
  return allTools().filter((t) => granted.includes(scopeFor(t.scopeGroup)));
}

/** Shapes a tool as a Gemini function declaration. */
export function toDeclaration(t: WorkspaceTool) {
  return {
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  };
}
