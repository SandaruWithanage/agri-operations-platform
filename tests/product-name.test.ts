// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { applicationFullName, applicationName } from "../packages/ui/src/index";

const root = resolve(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (["node_modules", ".next", "dist", "coverage"].includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

describe("product name", () => {
  it("is GoviAxis, with the full system name available", () => {
    expect(applicationName).toBe("GoviAxis");
    expect(applicationFullName).toBe(
      "GoviAxis | Integrated Agricultural Operations Management System",
    );
  });

  it("does not leave the old working name in application or package source", () => {
    const old =
      /Agri(?:cultural)? Operations(?! staff)(?! Management)|Agri Field/;
    const offenders = ["apps", "packages"]
      .flatMap((d) => sources(join(root, d)))
      .filter((file) => old.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it("names the installed app and the page titles with GoviAxis", () => {
    const manifest = readFileSync(
      join(root, "apps/field-pwa/app/manifest.ts"),
      "utf8",
    );
    expect(manifest).toContain('short_name: "GoviAxis"');
    expect(manifest).toContain(
      "Integrated Agricultural Operations Management System",
    );
    for (const layout of [
      "apps/admin-web/app/layout.tsx",
      "apps/field-pwa/app/layout.tsx",
    ])
      expect(readFileSync(join(root, layout), "utf8")).toContain(
        '"GoviAxis | ',
      );
  });
});
