import { existsSync } from "node:fs";
import { resolve } from "node:path";
const required = [
  ...[
    "ui",
    "design-tokens",
    "domain-types",
    "validation",
    "i18n",
    "sync-client",
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
if (missing.length) {
  console.error("Missing scaffold files:\n" + missing.join("\n"));
  process.exitCode = 1;
} else console.log("M0 repository structure: OK");
