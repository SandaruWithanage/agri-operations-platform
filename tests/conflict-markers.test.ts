// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
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

  it("fails the structure check when a tracked file carries a marker", () => {
    const root = resolve(__dirname, "..");
    const dir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
    execFileSync("git", ["init", "-q", dir]);
    const run = (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    execFileSync("sh", [
      "-c",
      `mkdir -p ${dir}/scripts && cp ${root}/scripts/check-structure.mjs ${root}/scripts/conflict-markers.mjs ${dir}/scripts/`,
    ]);
    execFileSync("sh", [
      "-c",
      `printf '%s\\n' '${open} HEAD' x > ${dir}/note.md`,
    ]);
    run("add", "-A");
    const result = spawnSync("node", ["scripts/check-structure.mjs"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("note.md:1");
    execFileSync("rm", ["-rf", dir]);
  });
});
