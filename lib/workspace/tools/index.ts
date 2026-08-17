import { registerTools, toolsForScopes, type WorkspaceTool } from "../registry";
import { TOOL_SCOPE_REQUIREMENTS } from "@/lib/google/scopes";
import { gmailTools } from "./gmail";
import { calendarTools } from "./calendar";
import { driveTools } from "./drive";
import { docsTools } from "./docs";
import { sheetsTools } from "./sheets";

// Registration happens once at module load; the registry is a module singleton so
// the orchestrator can resolve a tool by name from a streamed function call.
registerTools([...gmailTools, ...calendarTools, ...driveTools, ...docsTools, ...sheetsTools]);

/**
 * The tools this user can actually use.
 *
 * Filtered by granted scopes rather than offered unconditionally: handing the model a
 * declaration it cannot execute produces a confident answer followed by a permission
 * error, which reads as a bug. Better that the capability simply isn't there.
 */
export function availableTools(grantedScopes: string[]): WorkspaceTool[] {
  return toolsForScopes(grantedScopes, (group) => TOOL_SCOPE_REQUIREMENTS[group] ?? "");
}

export { gmailTools, calendarTools, driveTools, docsTools, sheetsTools };
