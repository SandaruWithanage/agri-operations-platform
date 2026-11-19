import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
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
const textFile =
  /\.(md|mdx|ts|tsx|mjs|cjs|js|json|css|yml|yaml|sql|html|txt)$/i;
const conflicted = [];
for (const path of execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => textFile.test(file) && !file.endsWith("pnpm-lock.yaml"))) {
  try {
    if (!statSync(path).isFile()) continue;
    const lines = findConflictMarkers(readFileSync(path, "utf8"));
    if (lines.length) conflicted.push(`${path}:${lines.slice(0, 3).join(",")}`);
  } catch {
    // an unreadable or deleted file is reported by other checks; this one only looks for markers
  }
}
if (missing.length || conflicted.length) {
  if (missing.length)
    console.error("Missing scaffold files:\n" + missing.join("\n"));
  if (conflicted.length)
    console.error("Merge-conflict markers left in:\n" + conflicted.join("\n"));
  process.exitCode = 1;
} else console.log("M0 repository structure: OK");
