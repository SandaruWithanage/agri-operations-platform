import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { findConflictMarkers } from "./conflict-markers.mjs";
const required = [
  ...[
    "ui",
    "design-tokens",
    "domain-types",
    "validation",
    "i18n",
    "sync-client",
    "security-events",
  ].map((name) => `packages/${name}/package.json`),
  "apps/admin-web/app/page.tsx",
  "apps/field-pwa/app/page.tsx",
  "apps/api/src/main.ts",
  "database/sql/README.md",
  "infrastructure/compose.yaml",
  "docs/security/ABAC_GATE.md",
  "pnpm-workspace.yaml",
  ".env.example",
];
const missing = required.filter((p) => !existsSync(resolve(p)));
// Leftover merge-conflict markers in tracked text files (a formatter can disguise them, so they are checked here).
// Each file is opened once and checked and read through the same descriptor, so it cannot change in between, and a
// tracked file that cannot be read fails the check instead of being skipped.
const textFile =
  /\.(md|mdx|ts|tsx|mjs|cjs|js|json|css|yml|yaml|sql|html|txt)$/i;
const conflicted = [];
const unreadable = [];
const entries = execFileSync("git", ["ls-files", "-z", "-s"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .map((entry) => /^(\d{6}) [0-9a-f]+ \d\t([\s\S]+)$/.exec(entry));
for (const entry of entries) {
  if (!entry) {
    unreadable.push("(unparseable git entry)");
    continue;
  }
  const [, mode, path] = entry;
  // Symbolic links (120000) and submodules (160000) have no text of their own to check.
  if (mode === "120000" || mode === "160000") continue;
  if (!textFile.test(path) || path.endsWith("pnpm-lock.yaml")) continue;
  let fd;
  try {
    fd = openSync(resolve(path), "r");
    if (!fstatSync(fd).isFile()) continue;
    const lines = findConflictMarkers(readFileSync(fd, "utf8"));
    if (lines.length) conflicted.push(`${path}:${lines.slice(0, 3).join(",")}`);
  } catch (error) {
    unreadable.push(`${path} (${error?.code ?? "UNKNOWN"})`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
if (missing.length || conflicted.length || unreadable.length) {
  if (missing.length)
    console.error("Missing scaffold files:\n" + missing.join("\n"));
  if (unreadable.length)
    console.error(
      "Tracked files that could not be read:\n" + unreadable.join("\n"),
    );
  if (conflicted.length)
    console.error("Merge-conflict markers left in:\n" + conflicted.join("\n"));
  process.exitCode = 1;
} else console.log("M0 repository structure: OK");
