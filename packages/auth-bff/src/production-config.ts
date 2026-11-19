/**
 * Production start-up checks for the BFF (SEC-A1 in docs/security/SECURITY_BASELINE_AUDIT.md).
 *
 * The BFF itself validates its settings lazily and answers 503 until they are valid. That is deliberate for
 * development and for a deployment where authentication is not switched on at all. It is the wrong behaviour for
 * a deployment that *has* configured the BFF: a mistake would then show up only when a person first signs in, and
 * the most dangerous mistake, an unset or wrong proxy hop count, is silently accepted.
 *
 * Rule: in production, if any BFF setting is present, the whole set must be valid and the proxy hop count must
 * be stated explicitly, or the server must refuse to start. Nothing configured at all is left alone (the BFF then
 * answers 503 "not configured"). Error text names variables and reason codes only, never a value, because the
 * internal key is a secret.
 */
export type ProductionConfigProblem = {
  variable: string;
  reason:
    | "missing"
    | "not-https-origin"
    | "too-short"
    | "not-an-integer"
    | "out-of-range"
    | "unattributed-needs-acknowledgement";
};

const settings = [
  "PILOT_API_ORIGIN",
  "PILOT_PUBLIC_ORIGIN",
  "PILOT_INTERNAL_KEY",
  "PILOT_TRUSTED_PROXY_HOPS",
] as const;

function httpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** Pure check: returns every problem found; an empty list means the environment may start. */
export function productionBffProblems(
  env: Record<string, string | undefined>,
): ProductionConfigProblem[] {
  if (env.NODE_ENV !== "production") return [];
  const configured = settings.some((name) => (env[name] ?? "").trim() !== "");
  if (!configured) return [];
  const problems: ProductionConfigProblem[] = [];
  for (const name of ["PILOT_API_ORIGIN", "PILOT_PUBLIC_ORIGIN"] as const) {
    const value = (env[name] ?? "").trim();
    if (value === "") problems.push({ variable: name, reason: "missing" });
    else if (!httpsOrigin(value))
      problems.push({ variable: name, reason: "not-https-origin" });
  }
  const key = env.PILOT_INTERNAL_KEY ?? "";
  if (key === "")
    problems.push({ variable: "PILOT_INTERNAL_KEY", reason: "missing" });
  else if (key.length < 43)
    problems.push({ variable: "PILOT_INTERNAL_KEY", reason: "too-short" });
  const hops = (env.PILOT_TRUSTED_PROXY_HOPS ?? "").trim();
  if (hops === "")
    problems.push({ variable: "PILOT_TRUSTED_PROXY_HOPS", reason: "missing" });
  else if (!/^\d+$/.test(hops))
    problems.push({
      variable: "PILOT_TRUSTED_PROXY_HOPS",
      reason: "not-an-integer",
    });
  else if (Number(hops) > 5)
    problems.push({
      variable: "PILOT_TRUSTED_PROXY_HOPS",
      reason: "out-of-range",
    });
  else if (
    Number(hops) === 0 &&
    env.PILOT_ACCEPT_UNATTRIBUTED_CLIENTS !== "true"
  )
    problems.push({
      variable: "PILOT_TRUSTED_PROXY_HOPS",
      reason: "unattributed-needs-acknowledgement",
    });
  return problems;
}

/** Throws before the server accepts traffic when the production environment is unsafe. */
export function assertProductionBffEnvironment(
  env: Record<string, string | undefined>,
): void {
  const problems = productionBffProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    "Unsafe production BFF configuration: " +
      problems.map((p) => `${p.variable} (${p.reason})`).join(", "),
  );
}
