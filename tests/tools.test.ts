import { describe, expect, it } from "vitest";
import { availableTools } from "@/lib/workspace/tools";
import { allTools, getTool, toDeclaration } from "@/lib/workspace/registry";
import { TOOL_SCOPE_REQUIREMENTS, WORKSPACE_SCOPE_STRINGS, missingScopes } from "@/lib/google/scopes";

/** Every tool that changes something in the user's account must be gated. */
const MUTATING = [
  "gmail_create_draft",
  "gmail_send_message",
  "calendar_create_event",
  "docs_create_document",
  "docs_append_text",
  "sheets_write_range",
  "sheets_create_spreadsheet",
];

const READ_ONLY = [
  "gmail_search_messages",
  "gmail_read_message",
  "calendar_list_events",
  "drive_search_files",
  "drive_read_file",
  "docs_read_document",
  "sheets_read_range",
];

describe("tool registry", () => {
  it("registers every tool group", () => {
    const names = allTools().map((t) => t.name);
    for (const n of [...MUTATING, ...READ_ONLY]) expect(names).toContain(n);
  });

  it("requires confirmation for every mutating tool", () => {
    // This is the product's safety boundary. If one of these ever flips to false,
    // the agent can send mail or change a document with no human in the loop.
    for (const name of MUTATING) {
      expect(getTool(name)?.requiresConfirmation, `${name} must require confirmation`).toBe(true);
    }
  });

  it("lets read-only tools run inline", () => {
    for (const name of READ_ONLY) {
      expect(getTool(name)?.requiresConfirmation, `${name} should not prompt`).toBe(false);
    }
  });

  it("declares a usable JSON Schema for each tool", () => {
    for (const t of allTools()) {
      const d = toDeclaration(t);
      expect(d.type).toBe("function");
      expect(d.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(d.description.length).toBeGreaterThan(20);
      const params = d.parameters as { type?: string; properties?: Record<string, unknown> };
      expect(params.type).toBe("object");
      expect(params.properties).toBeTypeOf("object");
    }
  });

  it("produces a non-empty summary for the confirmation card", () => {
    for (const t of allTools()) {
      expect(t.summarize({}).length).toBeGreaterThan(0);
    }
  });

  it("maps every tool to a scope that is actually requested", () => {
    for (const t of allTools()) {
      const scope = TOOL_SCOPE_REQUIREMENTS[t.scopeGroup];
      expect(scope, `${t.name} has no scope mapping`).toBeTruthy();
      expect(WORKSPACE_SCOPE_STRINGS).toContain(scope);
    }
  });
});

describe("availableTools", () => {
  it("offers nothing before Workspace is connected", () => {
    expect(availableTools([])).toEqual([]);
  });

  it("offers only what the granted scopes cover", () => {
    // Consent screens let people untick individual permissions, so a partial grant
    // is normal — the matching tools should disappear rather than fail mid-answer.
    const names = availableTools([TOOL_SCOPE_REQUIREMENTS.calendar]).map((t) => t.name);
    expect(names).toContain("calendar_list_events");
    expect(names).toContain("calendar_create_event");
    expect(names).not.toContain("gmail_send_message");
  });

  it("offers everything on a full grant", () => {
    expect(availableTools(WORKSPACE_SCOPE_STRINGS)).toHaveLength(allTools().length);
  });
});

describe("scopes", () => {
  it("reports what a partial grant is missing", () => {
    const missing = missingScopes([TOOL_SCOPE_REQUIREMENTS.calendar]);
    expect(missing.length).toBe(WORKSPACE_SCOPE_STRINGS.length - 1);
    expect(missing.every((s) => s.reason.length > 0)).toBe(true);
  });

  it("keeps drive.file alongside drive.readonly", () => {
    // readonly cannot create the memory files; they are complementary, and dropping
    // either one silently breaks a different half of the product.
    expect(WORKSPACE_SCOPE_STRINGS).toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(WORKSPACE_SCOPE_STRINGS).toContain("https://www.googleapis.com/auth/drive.file");
  });
});
