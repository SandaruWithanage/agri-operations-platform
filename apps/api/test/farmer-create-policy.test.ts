// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  mayCreateFarmer,
  type RegistrationActor,
  type RegistrationTarget,
} from "../src/authorization/farmer-create-policy";
const now = 1000;
const target: RegistrationTarget = {
  organizationId: "org",
  geographyId: "gn-a",
  organizationalUnitAncestors: ["unit-a", "parent"],
};
const grant = {
  enabled: true,
  startsAt: 0,
  permission: "farmer.create",
  organizationId: "org",
  scope: {},
  coverage: "assigned" as const,
};
const assignment = {
  enabled: true,
  startsAt: 0,
  organizationId: "org",
  scope: { geographyId: "gn-a" },
};
const officer: RegistrationActor = {
  authenticated: true,
  enabled: true,
  grants: [grant],
  assignments: [assignment],
};

describe("provisional farmer-create application policy", () => {
  it("allows an active explicit create grant within active assigned coverage", () => {
    expect(mayCreateFarmer(officer, target, now)).toBe(true);
    expect(
      mayCreateFarmer(
        {
          ...officer,
          grants: [{ ...grant, coverage: "organization" }],
          assignments: [],
        },
        target,
        now,
      ),
    ).toBe(true);
  });
  it("fails closed for unauthenticated, suspended, expired, missing permission and empty assignments", () => {
    expect(
      mayCreateFarmer({ ...officer, authenticated: false }, target, now),
    ).toBe(false);
    expect(mayCreateFarmer({ ...officer, enabled: false }, target, now)).toBe(
      false,
    );
    expect(
      mayCreateFarmer(
        { ...officer, grants: [{ ...grant, expiresAt: now }] },
        target,
        now,
      ),
    ).toBe(false);
    expect(
      mayCreateFarmer(
        { ...officer, grants: [{ ...grant, permission: "farmer.read" }] },
        target,
        now,
      ),
    ).toBe(false);
    expect(
      mayCreateFarmer(
        { ...officer, assignments: [{ ...assignment, scope: {} }] },
        target,
        now,
      ),
    ).toBe(false);
    expect(
      mayCreateFarmer(
        { ...officer, assignments: [{ ...assignment, enabled: false }] },
        target,
        now,
      ),
    ).toBe(false);
    expect(mayCreateFarmer(officer, target, NaN)).toBe(false);
  });
  it("requires both geography and organizational constraints to match", () => {
    const scoped = {
      ...officer,
      grants: [
        {
          ...grant,
          scope: { geographyId: "gn-a", organizationalUnitId: "parent" },
        },
      ],
      assignments: [
        {
          ...assignment,
          scope: { geographyId: "gn-a", organizationalUnitId: "unit-a" },
        },
      ],
    };
    expect(mayCreateFarmer(scoped, target, now)).toBe(true);
    expect(
      mayCreateFarmer(scoped, { ...target, geographyId: "gn-b" }, now),
    ).toBe(false);
    expect(
      mayCreateFarmer(
        scoped,
        { ...target, organizationalUnitAncestors: ["other"] },
        now,
      ),
    ).toBe(false);
    expect(
      mayCreateFarmer(scoped, { ...target, organizationId: "other" }, now),
    ).toBe(false);
  });
  it("combines independently valid grants without granting authority from a coordinator title", () => {
    expect(
      mayCreateFarmer(
        {
          ...officer,
          grants: [{ ...grant, scope: { geographyId: "other" } }, grant],
        },
        target,
        now,
      ),
    ).toBe(true);
    expect(mayCreateFarmer({ ...officer, grants: [] }, target, now)).toBe(
      false,
    );
  });
});
