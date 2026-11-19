import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import {
  PermissionAction,
  PermissionProvider,
  permissionState,
} from "../packages/ui/src/permission-action";
import { permissionCodes } from "../packages/ui/src/permission-codes";

afterEach(() => cleanup());

describe("permission state", () => {
  const some = new Set(["farmer.verify"]);
  it.each([
    ["unknown, no record flag", "unknown", undefined, "server-checked"],
    ["unknown, record allows", "unknown", true, "allowed"],
    ["unknown, record denies", "unknown", false, "denied"],
    ["list has code", some, undefined, "allowed"],
    ["list lacks code", new Set<string>(), undefined, "denied"],
    ["list has code, record denies", some, false, "denied"],
    ["list lacks code, record allows", new Set<string>(), true, "denied"],
  ] as const)("%s", (_label, capabilities, record, expected) => {
    expect(permissionState(capabilities, "farmer.verify", record)).toBe(
      expected,
    );
  });
});

describe("PermissionAction", () => {
  it("shows the action, marked as server-checked, when permissions are unknown", () => {
    render(<PermissionAction code="farmer.verify">Verify</PermissionAction>);
    const button = screen.getByRole("button", { name: "Verify" });
    expect(button.getAttribute("data-permission-code")).toBe("farmer.verify");
    expect(button.getAttribute("data-permission-state")).toBe("server-checked");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
  it("removes the action when the account lacks the permission", () => {
    render(
      <PermissionProvider capabilities={new Set(["farmer.read"])}>
        <PermissionAction code="enrollment.withdraw">Withdraw</PermissionAction>
      </PermissionProvider>,
    );
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });
  it("can show a denied action disabled instead of removing it", () => {
    render(
      <PermissionProvider capabilities={new Set<string>()}>
        <PermissionAction code="project.update" whenDenied="disable">
          Edit
        </PermissionAction>
      </PermissionProvider>,
    );
    const button = screen.getByRole("button", { name: "Edit" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });
  it("keeps the action when the account has the permission", () => {
    render(
      <PermissionProvider capabilities={new Set(["project.update"])}>
        <PermissionAction code="project.update">Edit</PermissionAction>
      </PermissionProvider>,
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
  it("lets a record-level denial from the server win over the account list", () => {
    render(
      <PermissionProvider capabilities={new Set(["farmer.correct"])}>
        <PermissionAction code="farmer.correct" recordAllowed={false}>
          Correct
        </PermissionAction>
      </PermissionProvider>,
    );
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
  });
});

describe("development rule guards", () => {
  const root = join(__dirname, "..");
  const components = join(root, "apps/admin-web/components");
  const files = readdirSync(components).filter((name) => name.endsWith(".tsx"));
  const source = (name: string) => readFileSync(join(components, name), "utf8");

  it("only uses permission codes that PostgreSQL checks as permissions", () => {
    const migrations = join(root, "database/migrations");
    const sql = readdirSync(migrations, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(migrations, name), "utf8"))
      .join("\n");
    // A code must appear where the database evaluates a permission (a predicate
    // call, a p_permission comparison or a grant's permission column). Appearing
    // only as an audit action name or a comment does not count: that is how
    // "enrollment.policy.set" (a journal action) was once mistaken for the
    // permission "enrollment.policy".
    for (const code of permissionCodes) {
      const q = code.replaceAll(".", "\\.");
      const patterns = [
        new RegExp(`allowed\\w*\\([^;]*?'${q}'`, "s"),
        new RegExp(`p_permission\\s*(?:=|IN)[^;]*?'${q}'`, "s"),
        new RegExp(`permission\\s*=\\s*'${q}'`),
        new RegExp(`permission\\s+IN\\s*\\([^)]*'${q}'`),
      ];
      expect(
        patterns.some((pattern) => pattern.test(sql)),
        `not checked as a permission in the migrations: ${code}`,
      ).toBe(true);
    }
    expect(permissionCodes as readonly string[]).not.toContain(
      "enrollment.policy.set",
    );
  });

  it("gives every PermissionAction a registered code", () => {
    for (const name of files)
      for (const match of source(name).matchAll(
        /<PermissionAction\s[^>]*?code="([^"]+)"/g,
      ))
        expect(permissionCodes as readonly string[]).toContain(match[1]);
  });

  it("never renders a consequential action as a raw button", () => {
    const handlers =
      "onRegister|onRegisterLand|onRegisterProject|onCorrect|onEnrollFarmer|onWithdraw|onEdit|onPolicy";
    const raw = new RegExp(
      `<button\\s[^<]*?onClick=\\{\\(\\) => (?:${handlers})\\(`,
      "g",
    );
    for (const name of files)
      expect(source(name).match(raw), `raw button in ${name}`).toBeNull();
    // Verification calls the mutation directly, so check that one by its action.
    expect(source("farmer-verification.tsx")).toMatch(
      /<PermissionAction\s+code="farmer\.verify"/,
    );
  });

  it("gives every sidebar page a read permission from the registry", () => {
    const text = source("farmer-registry.tsx");
    const block = text.slice(
      text.indexOf("items={("),
      text.indexOf(".map(([id, icon"),
    );
    const codes = [
      ...block.matchAll(/"((?:farmer|land|project|enrollment)\.read)"/g),
    ];
    expect(codes.map((match) => match[1]).sort()).toEqual([
      "enrollment.read",
      "farmer.read",
      "land.read",
      "project.read",
    ]);
  });
});
