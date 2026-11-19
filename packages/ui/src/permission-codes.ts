/**
 * Every permission code a screen may gate an action on (UI rule 3 in
 * docs/development/UI_DEVELOPMENT_RULES.md). These are the codes PostgreSQL already
 * defines; tests/permission-action.test.ts checks each one exists in the database
 * migrations, so a typo cannot silently show or hide a button.
 */
export const permissionCodes = [
  "farmer.read",
  "farmer.create",
  "farmer.verify",
  "farmer.correct",
  "farmer.audit.read",
  "land.read",
  "land.create",
  "project.read",
  "project.create",
  "project.update",
  "enrollment.read",
  "enrollment.create",
  "enrollment.policy.set",
  "enrollment.withdraw",
] as const;

export type PermissionCode = (typeof permissionCodes)[number];
