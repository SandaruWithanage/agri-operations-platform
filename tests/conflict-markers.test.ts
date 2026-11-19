// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error plain ESM script without type declarations
import { findConflictMarkers } from "../scripts/conflict-markers.mjs";

// Markers are assembled at run time so this file does not contain a marker line itself.
const open = "<".repeat(7);
const close = ">".repeat(7);
const mid = "=".repeat(7);
const find = findConflictMarkers as (text: string) => number[];

describe("conflict marker guard", () => {
  it("finds plain markers", () => {
    expect(
      find(`a\n${open} HEAD\nb\n${mid}\nc\n${close} origin/main\nd`),
    ).toEqual([2, 4, 6]);
  });

  it("finds the forms a formatter makes of them in a Markdown table", () => {
    const table = `| a |\n| - |\n| ${open} HEAD |\n| row |\n| ${mid}      |\n| row |\n\n${Array(7).fill(">").join(" ")} origin/main\n`;
    expect(find(table).length).toBe(3);
  });

  it("does not flag a heading underline or marker-like text inside a line", () => {
    expect(find(`Title\n${mid}\n\ntext`)).toEqual([]);
    expect(find(`a ${open} b ${close} c`)).toEqual([]);
    expect(find("a > b\n> quote")).toEqual([]);
  });

  it("is clean on every tracked file of this repository", () => {
    const result = spawnSync("node", ["scripts/check-structure.mjs"], {
      cwd: resolve(__dirname, ".."),
      encoding: "utf8",
    });
    expect(result.stderr).not.toContain("Merge-conflict markers");
    expect(result.status).toBe(0);
  });

  const project = (name: string, files: Record<string, string>) => {
    const root = resolve(__dirname, "..");
    const dir = mkdtempSync(join(tmpdir(), `${name}-`));
    execFileSync("git", ["init", "-q", dir]);
    mkdirSync(join(dir, "scripts"));
    for (const file of ["check-structure.mjs", "conflict-markers.mjs"])
      copyFileSync(join(root, "scripts", file), join(dir, "scripts", file));
    for (const [path, text] of Object.entries(files))
      writeFileSync(join(dir, path), text);
    execFileSync("git", ["-C", dir, "add", "-A"]);
    return dir;
  };
  const check = (dir: string) =>
    spawnSync("node", ["scripts/check-structure.mjs"], {
      cwd: dir,
      encoding: "utf8",
    });

  it("fails the structure check when a tracked file carries a marker", () => {
    const dir = project("marker", { "note.md": `${open} HEAD\nx\n` });
    try {
      const result = check(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("note.md:1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails, and does not skip, a tracked file that cannot be read", () => {
    const dir = project("unreadable", { "gone.md": "fine\n" });
    try {
      rmSync(join(dir, "gone.md"));
      const result = check(dir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("could not be read");
      expect(result.stderr).toContain("gone.md (ENOENT)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not treat a symbolic link or a clean file as a problem", () => {
    const dir = project("clean", { "ok.md": "Title\n" + mid + "\n" });
    try {
      symlinkSync("does-not-exist", join(dir, "dangling.md"));
      execFileSync("git", ["-C", dir, "add", "-A"]);
      const result = check(dir);
      expect(result.stderr).not.toContain("could not be read");
      expect(result.stderr).not.toContain("Merge-conflict markers");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
