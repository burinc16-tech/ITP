/**
 * Roles (SPEC §9). With the API configured the acting role comes from the
 * signed-in user (email/password sessions, task 4); in local-only mode the app
 * falls back to a stub "acting role" picker so transitions can still be gated and
 * audit entries attributed. Only the two roles that drive the Phase 3 workflow are
 * selectable in that picker; the rest are declared so the permission model is
 * complete.
 */
export type Role =
  | "site_engineer"
  | "qa_qc"
  | "project_admin"
  | "template_admin"
  | "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  site_engineer: "Site Engineer",
  qa_qc: "QA/QC",
  project_admin: "Project Admin",
  template_admin: "Template Admin",
  viewer: "Viewer",
};

/** Roles a user can act as on-device during Phase 3. */
export const ACTING_ROLES: Role[] = ["site_engineer", "qa_qc"];
