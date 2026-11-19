import { productionBffProblems } from "@agri/auth-bff";

/**
 * In production, a BFF that is configured but unsafe must not run. Next.js would otherwise keep the process
 * alive and answer every request with HTTP 500, which hides the cause from a process supervisor. Exiting with a
 * non-zero status makes the failure immediate and visible. The message names variables and reason codes only,
 * never a value, because the internal key is a secret.
 */
const problems = productionBffProblems(process.env);
if (problems.length > 0) {
  console.error(
    "Unsafe production BFF configuration, refusing to start: " +
      problems.map((p) => `${p.variable} (${p.reason})`).join(", "),
  );
  process.exit(1);
}
