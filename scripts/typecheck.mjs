import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
// TypeScript 7 is the project compiler. Tooling that imports the legacy TS API
// resolves TypeScript 6 separately until upstream supports the new native API.
const compiler = fileURLToPath(
  new URL("../node_modules/typescript7/bin/tsc", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [compiler, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
if (result.error)
  console.error("The project TypeScript compiler could not start");
process.exitCode = result.status ?? 1;
