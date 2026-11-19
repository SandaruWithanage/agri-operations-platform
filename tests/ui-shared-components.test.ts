import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** UI rule 1: shared components first (docs/development/UI_DEVELOPMENT_RULES.md). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next" || name === "dist")
      return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

describe("shared components", () => {
  const root = join(__dirname, "..");
  const files = [
    ...sources(join(root, "apps/admin-web")),
    ...sources(join(root, "apps/field-pwa")),
  ];

  it("keeps the language switch in @agri/ui, never hand-written in an app", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/aria-pressed=\{\s*language\s*===/);
      expect(text, file).not.toMatch(/aria-pressed=\{\s*locale\s*===/);
    }
  });

  it("does not style controls inline in app screens", () => {
    for (const file of files.filter((name) => name.endsWith(".tsx"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/style=\{\{/);
    }
  });
});
