/**
 * Provisional application-side policy. Inputs must be loaded from trusted,
 * current database state. PostgreSQL RLS must independently enforce access.
 * This function is not wired to any endpoint or a substitute for authentication.
 */
export type Scope = { geographyId?: string; organizationalUnitId?: string };
export type RegistrationTarget = {
  organizationId: string;
  geographyId: string;
  /** Contains only database-derived ancestors, including the target unit itself. */
  organizationalUnitAncestors: readonly string[];
};
export type AccessWindow = {
  enabled: boolean;
  startsAt: number;
  expiresAt?: number;
};
export type CreateGrant = AccessWindow & {
  permission: string;
  organizationId: string;
  scope: Scope;
  coverage: "organization" | "assigned";
};
export type Assignment = AccessWindow & {
  organizationId: string;
  scope: Scope;
};
export type RegistrationActor = {
  authenticated: boolean;
  enabled: boolean;
  grants: readonly CreateGrant[];
  assignments: readonly Assignment[];
};

function active(window: AccessWindow, now: number): boolean {
  return (
    window.enabled === true &&
    Number.isFinite(window.startsAt) &&
    window.startsAt <= now &&
    (window.expiresAt === undefined ||
      (Number.isFinite(window.expiresAt) && now < window.expiresAt))
  );
}
function matches(scope: Scope, target: RegistrationTarget): boolean {
  return (
    (scope.geographyId === undefined ||
      scope.geographyId === target.geographyId) &&
    (scope.organizationalUnitId === undefined ||
      target.organizationalUnitAncestors.includes(scope.organizationalUnitId))
  );
}
/** Grants are ORed; every constraint in an individual grant and assignment is ANDed. */
export function mayCreateFarmer(
  actor: RegistrationActor,
  target: RegistrationTarget,
  now: number,
): boolean {
  if (
    !actor.authenticated ||
    !actor.enabled ||
    !Number.isFinite(now) ||
    !target.organizationId ||
    !target.geographyId
  )
    return false;
  return actor.grants.some((grant) => {
    if (
      !active(grant, now) ||
      grant.permission !== "farmer.create" ||
      grant.organizationId !== target.organizationId ||
      !matches(grant.scope, target)
    )
      return false;
    if (grant.coverage === "organization") return true;
    if (grant.coverage !== "assigned") return false;
    return actor.assignments.some(
      (assignment) =>
        active(assignment, now) &&
        assignment.organizationId === target.organizationId &&
        (assignment.scope.geographyId !== undefined ||
          assignment.scope.organizationalUnitId !== undefined) &&
        matches(assignment.scope, target),
    );
  });
}
