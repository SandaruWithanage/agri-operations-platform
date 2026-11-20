#!/usr/bin/env node
/**
 * SEC-A4 measurement harness, command line (docs/security/REQUEST_BUDGETS_MEASUREMENT_PROTOCOL.md).
 *
 * Default is a DRY RUN: it validates the plan, prints it and opens no connection. A real run needs `--run`,
 * `--authorised`, `--ref <reference>` and MEASURE_DISPOSABLE_STACK set to the acknowledgement string, a loopback
 * `--target`, and NODE_ENV other than production. It measures existing behaviour and activates no limit.
 *
 * Exit status: 0 dry run printed or run finished, 2 refused or invalid.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  disposableAcknowledgement,
  runPlan,
  scenarios,
  validatePlan,
} from "./measure-budgets-lib.mjs";

const flags = new Map();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (!arg.startsWith("--")) {
    console.error(`Unexpected argument: ${arg}`);
    process.exit(2);
  }
  const name = arg.slice(2);
  const boolean = ["run", "authorised"].includes(name);
  if (boolean) flags.set(name, true);
  else {
    flags.set(name, args[i + 1]);
    i += 1;
  }
}
const known = new Set([
  "target",
  "scenario",
  "requests",
  "concurrency",
  "duration-ms",
  "ref",
  "out",
  "run",
  "authorised",
]);
for (const name of flags.keys())
  if (!known.has(name)) {
    console.error(`Unknown option: --${name}`);
    process.exit(2);
  }

const checked = validatePlan(
  {
    target: flags.get("target"),
    scenario: flags.get("scenario"),
    requests: flags.get("requests"),
    concurrency: flags.get("concurrency"),
    durationMs: flags.get("duration-ms"),
    authorised: flags.get("authorised") === true,
    authorisationRef: flags.get("ref"),
  },
  process.env,
);

if (checked.problems.length) {
  console.error("Refused: the plan is not valid.");
  for (const problem of checked.problems) console.error(`  - ${problem}`);
  console.error(`Scenarios: ${Object.keys(scenarios).join(", ")}`);
  process.exit(2);
}

if (!flags.get("run")) {
  console.log("DRY RUN: no connection was opened. Plan:");
  console.log(JSON.stringify(checked.plan, null, 2));
  if (checked.gates.length) {
    console.log("A real run would currently be refused because:");
    for (const gate of checked.gates) console.log(`  - ${gate}`);
  } else console.log("All gates are satisfied; add --run to execute.");
  console.log(
    `(Acknowledgement string: MEASURE_DISPOSABLE_STACK=${disposableAcknowledgement})`,
  );
  process.exit(0);
}

if (!checked.runnable) {
  console.error("Refused: a real run is not permitted.");
  for (const gate of checked.gates) console.error(`  - ${gate}`);
  process.exit(2);
}

const report = await runPlan(checked.plan);
const text = JSON.stringify(report, null, 2);
if (flags.get("out"))
  writeFileSync(resolve(flags.get("out")), text + "\n", { flag: "wx" });
else console.log(text);
process.exit(0);
