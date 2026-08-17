/**
 * Google OAuth scopes, split by what they cost the user.
 *
 * Sign-in asks for nothing but identity. The Workspace scopes are requested later,
 * in a separate consent, so the login screen isn't a wall of permissions.
 */

/** Requested at sign-in. Non-sensitive; no Google review involved. */
export const SIGNIN_SCOPES = ["openid", "email", "profile"] as const;

type ScopeClass = "restricted" | "sensitive" | "basic";

export interface ScopeSpec {
  scope: string;
  /**
   * `restricted` needs Google app verification *and* a paid annual CASA security
   * assessment before any non-test user can grant it. `sensitive` needs review only.
   */
  klass: ScopeClass;
  /** Shown in the UI so the user knows why each permission is being asked for. */
  reason: string;
}

export const WORKSPACE_SCOPES: ScopeSpec[] = [
  {
    scope: "https://www.googleapis.com/auth/gmail.modify",
    klass: "restricted",
    reason: "Search your mail, and draft or send messages you approve",
  },
  {
    scope: "https://www.googleapis.com/auth/drive.readonly",
    klass: "restricted",
    reason: "Find and read your files when a search needs them",
  },
  {
    // Read-only Drive cannot create anything, so this is required alongside it for
    // the memory documents the app writes. Complementary, not redundant.
    scope: "https://www.googleapis.com/auth/drive.file",
    klass: "basic",
    reason: "Create and update your HeyKels memory documents",
  },
  {
    scope: "https://www.googleapis.com/auth/calendar.events",
    klass: "sensitive",
    reason: "Check your schedule and create events you approve",
  },
  {
    scope: "https://www.googleapis.com/auth/documents",
    klass: "sensitive",
    reason: "Read and write Google Docs",
  },
  {
    scope: "https://www.googleapis.com/auth/spreadsheets",
    klass: "sensitive",
    reason: "Read and write Google Sheets",
  },
];

export const WORKSPACE_SCOPE_STRINGS = WORKSPACE_SCOPES.map((s) => s.scope);

/** Scopes each tool group needs, so the UI can explain a gap instead of failing at the API. */
export const TOOL_SCOPE_REQUIREMENTS: Record<string, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.modify",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  drive: "https://www.googleapis.com/auth/drive.readonly",
  docs: "https://www.googleapis.com/auth/documents",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  memory: "https://www.googleapis.com/auth/drive.file",
};

export function hasScope(granted: string[], scope: string): boolean {
  return granted.includes(scope);
}

/**
 * Google returns the union of everything the user has granted, which may exceed
 * what we asked for (include_granted_scopes) or fall short of it (the consent
 * screen lets people untick individual permissions).
 */
export function missingScopes(granted: string[]): ScopeSpec[] {
  return WORKSPACE_SCOPES.filter((s) => !granted.includes(s.scope));
}
