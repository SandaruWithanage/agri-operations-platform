/**
 * Core of the SEC-A4 measurement harness (docs/security/REQUEST_BUDGETS_MEASUREMENT_PROTOCOL.md).
 *
 * It MEASURES the existing request and resource behaviour of a **disposable local stack**; it changes and activates
 * no limit. Safety is the design, and every guard below is tested:
 *
 * - The target must be a **numeric** loopback address over plain http (`127.0.0.1` or `[::1]`); names such as
 *   `localhost` are refused, so nothing is ever resolved and nothing can be redirected. There is no override.
 *   The peer address is also verified the moment a connection opens, and **no byte is sent before that check
 *   passes**; a non-loopback peer stops the whole run (issue 126).
 * - Paths are fixed per scenario and never taken from the caller, so the harness cannot be aimed at an arbitrary
 *   route; request bodies are synthetic and fixed.
 * - Hard ceilings on requests, concurrency, duration and body size, with no way to raise them.
 * - A run needs explicit authorisation (a flag, a recorded reference, and an environment acknowledgement) and is
 *   refused when NODE_ENV is production. Without them it is a dry run that opens no connection.
 * - Results are counts and timings only: no response body, header, cookie, token or identifier is recorded.
 */
import { Agent, request } from "node:http";
import { connect as netConnect } from "node:net";
import { Buffer } from "node:buffer";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";

export const harnessVersion = 1;

/** Ceilings that cannot be raised from the command line or the environment. */
export const ceilings = Object.freeze({
  requests: 5000,
  concurrency: 64,
  durationMs: 60_000,
  requestTimeoutMs: 10_000,
  bodyBytes: 65_536,
});

export const disposableAcknowledgement = "yes-this-is-a-disposable-stack";

/** One fixed path and method per scenario. The caller chooses the scenario, never the path. */
export const scenarios = Object.freeze({
  "ops-burst": {
    routeClass: "C8 operational",
    method: "GET",
    path: "/health",
    description: "Repeated GET of the unauthenticated health route.",
  },
  "anon-auth-burst": {
    routeClass: "C0 anonymous authentication",
    method: "POST",
    path: "/api/pilot/auth/login",
    description:
      "Repeated sign-in attempts with deliberately invalid synthetic credentials, to observe the anonymous budget.",
  },
  "oversize-body": {
    routeClass: "C0 body cap",
    method: "POST",
    path: "/api/pilot/auth/login",
    description:
      "A few requests with a body just over the BFF body cap, to observe that the cap refuses it.",
  },
});

const loopbackNames = new Set(["127.0.0.1", "[::1]"]);

/**
 * Parses and validates a target. Only an http origin on a loopback host is accepted: no credentials in the URL, no
 * path, query or fragment, and no lookalike host such as `127.0.0.1.example.test`.
 */
export function parseTarget(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "the target is not a valid URL" };
  }
  if (url.protocol !== "http:")
    return { ok: false, reason: "only plain http on loopback is allowed" };
  if (url.username || url.password)
    return { ok: false, reason: "credentials in the target are not allowed" };
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)
    return { ok: false, reason: "the target must be an origin only" };
  if (!loopbackNames.has(url.hostname))
    return {
      ok: false,
      reason:
        "the target must be a numeric loopback address (127.0.0.1 or [::1]); names are never resolved",
    };
  return {
    ok: true,
    origin: url.origin,
    hostname: url.hostname,
    port: Number(url.port || 80),
  };
}

/** True only for loopback peer addresses, including the IPv4-mapped form. */
export function isLoopbackAddress(address) {
  if (typeof address !== "string") return false;
  const value = address.startsWith("::ffff:") ? address.slice(7) : address;
  return value === "::1" || /^127(?:\.\d{1,3}){3}$/.test(value);
}

function integer(value, name, min, max) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(number) || number < min || number > max)
    return { error: `${name} must be a whole number from ${min} to ${max}` };
  return { value: number };
}

/**
 * Validates a plan. Returns `{ problems }` always, `plan` only when valid. `authorised` additionally requires the
 * run gates; a plan that is valid but not authorised is a dry run.
 */
export function validatePlan(input, env = {}) {
  const problems = [];
  const target = parseTarget(input.target ?? "");
  if (!target.ok) problems.push(target.reason);
  const scenario = scenarios[input.scenario];
  if (!scenario) problems.push("unknown scenario");
  const requests = integer(
    input.requests ?? 100,
    "requests",
    1,
    ceilings.requests,
  );
  const concurrency = integer(
    input.concurrency ?? 4,
    "concurrency",
    1,
    ceilings.concurrency,
  );
  const durationMs = integer(
    input.durationMs ?? 30_000,
    "duration",
    1000,
    ceilings.durationMs,
  );
  for (const r of [requests, concurrency, durationMs])
    if (r.error) problems.push(r.error);
  if (
    requests.value !== undefined &&
    concurrency.value !== undefined &&
    concurrency.value > requests.value
  )
    problems.push("concurrency cannot exceed the number of requests");
  if (input.scenario === "oversize-body" && requests.value > 20)
    problems.push("the oversize-body scenario allows at most 20 requests");

  const gates = [];
  if (env.NODE_ENV === "production") gates.push("NODE_ENV is production");
  if (!input.authorised) gates.push("the authorisation flag was not given");
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(input.authorisationRef ?? ""))
    gates.push(
      "a short authorisation reference (letters, digits, . _ : -) is required",
    );
  if (env.MEASURE_DISPOSABLE_STACK !== disposableAcknowledgement)
    gates.push("the disposable-stack acknowledgement is not set");

  if (problems.length) return { problems, gates, runnable: false };
  return {
    problems,
    gates,
    runnable: gates.length === 0,
    plan: {
      target: target.origin,
      scenario: input.scenario,
      routeClass: scenario.routeClass,
      method: scenario.method,
      path: scenario.path,
      requests: requests.value,
      concurrency: concurrency.value,
      durationMs: durationMs.value,
      authorisationRef: input.authorised
        ? (input.authorisationRef ?? null)
        : null,
    },
  };
}

/** Fixed synthetic bodies. They contain no real identifier and no real secret. */
export function bodyFor(scenario, index) {
  if (scenario === "anon-auth-burst")
    return JSON.stringify({
      username: `measure-user-${index % 50}`,
      password: "synthetic-wrong-password",
      otp: "000000",
      deviceId: "00000000-0000-4000-8000-000000000000",
    });
  if (scenario === "oversize-body")
    return JSON.stringify({ filler: "x".repeat(16_500) });
  return undefined;
}

export function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, rank))];
}

/** Counts and timings only: never a body, header, cookie, token or identifier. */
export function summarise(samples, startedAt, finishedAt) {
  const byStatus = {};
  const errors = {};
  const times = [];
  for (const sample of samples) {
    if (sample.error) errors[sample.error] = (errors[sample.error] ?? 0) + 1;
    else byStatus[sample.status] = (byStatus[sample.status] ?? 0) + 1;
    if (typeof sample.ms === "number") times.push(sample.ms);
  }
  times.sort((a, b) => a - b);
  const seconds = Math.max(0.001, (finishedAt - startedAt) / 1000);
  const refused = (byStatus[429] ?? 0) + (byStatus[503] ?? 0);
  return {
    sent: samples.length,
    byStatus,
    errors,
    refused,
    latencyMs: {
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      max: times.length ? times[times.length - 1] : null,
    },
    elapsedSeconds: Number(seconds.toFixed(3)),
    requestsPerSecond: Number((samples.length / seconds).toFixed(1)),
  };
}

const numericLoopbackHosts = new Set(["127.0.0.1", "::1"]);

function refuseNameResolution(_host, _options, callback) {
  callback(new Error("name resolution is not permitted"));
}

/**
 * Opens a connection to a numeric loopback address and sends nothing until the connected peer has been verified as
 * loopback. Writes made earlier by the HTTP client are held, then released after the check; if the check fails they
 * are discarded and the socket is destroyed, so **no HTTP byte reaches a non-loopback peer**, and a peer that never
 * answers is still rejected at connection time. Names are never resolved.
 */
export function guardedConnection({ host, port }, connect = netConnect) {
  if (!numericLoopbackHosts.has(host))
    throw new Error(
      "only a numeric loopback address may be connected to; names are never resolved",
    );
  const socket = connect({ host, port, lookup: refuseNameResolution });
  const held = [];
  let verified = false;
  const realWrite = socket.write.bind(socket);
  socket.write = (...args) => {
    if (verified) return realWrite(...args);
    held.push(args);
    return true;
  };
  socket.once("connect", () => {
    if (!isLoopbackAddress(socket.remoteAddress)) {
      held.length = 0;
      socket.destroy(
        Object.assign(new Error("non-loopback peer"), {
          code: "NON_LOOPBACK_PEER",
        }),
      );
      return;
    }
    verified = true;
    for (const args of held.splice(0)) realWrite(...args);
  });
  return socket;
}

function send(plan, index, signal, { transport, connect }) {
  const started = Date.now();
  const body = bodyFor(plan.scenario, index);
  const target = new URL(plan.target);
  return new Promise((resolve) => {
    const headers = { Origin: plan.target, Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    // One agent per request (like `agent: false`), but with the guarded connection: Node ignores a
    // `createConnection` option when an agent is in use, so the guard has to be the agent's own.
    const agent = new Agent({ keepAlive: false });
    agent.createConnection = (options) =>
      guardedConnection({ host: options.host, port: options.port }, connect);
    const req = transport(
      {
        hostname: target.hostname === "[::1]" ? "::1" : target.hostname,
        port: Number(target.port || 80),
        lookup: refuseNameResolution,
        method: plan.method,
        path: plan.path,
        headers,
        agent,
        signal,
        timeout: ceilings.requestTimeoutMs,
      },
      (res) => {
        if (!isLoopbackAddress(res.socket.remoteAddress)) {
          res.destroy();
          resolve({ error: "non-loopback-peer", fatal: true });
          return;
        }
        res.resume(); // the body is drained and discarded; it is never read or stored
        res.on("end", () =>
          resolve({ status: res.statusCode, ms: Date.now() - started }),
        );
        res.on("error", () =>
          resolve({ error: "response-error", ms: Date.now() - started }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) =>
      resolve(
        error?.code === "NON_LOOPBACK_PEER"
          ? { error: "non-loopback-peer", fatal: true }
          : {
              error:
                error?.name === "AbortError"
                  ? "aborted"
                  : error?.message === "timeout"
                    ? "timeout"
                    : "connection-error",
              ms: Date.now() - started,
            },
      ),
    );
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Runs a validated, runnable plan. Stops early at the duration ceiling or on a non-loopback peer. */
export async function runPlan(plan, options = {}) {
  const transport = options.transport ?? request;
  const connect = options.connect ?? netConnect;
  const controller = new globalThis.AbortController();
  const startedAt = Date.now();
  const deadline = setTimeout(() => controller.abort(), plan.durationMs);
  const samples = [];
  let next = 0;
  let fatal = false;
  async function worker() {
    while (!fatal && !controller.signal.aborted) {
      const index = next;
      if (index >= plan.requests) return;
      next += 1;
      const sample = await send(plan, index, controller.signal, {
        transport,
        connect,
      });
      if (sample.fatal) {
        fatal = true;
        controller.abort();
        return;
      }
      if (fatal) return; // in-flight requests aborted by a fatal stop are not results
      samples.push(sample);
    }
  }
  try {
    await Promise.all(Array.from({ length: plan.concurrency }, worker));
  } finally {
    clearTimeout(deadline);
  }
  const finishedAt = Date.now();
  return {
    harnessVersion,
    plan,
    stoppedEarly: fatal
      ? "non-loopback peer"
      : samples.length < plan.requests
        ? "duration ceiling"
        : null,
    result: summarise(samples, startedAt, finishedAt),
    notes: [
      "One run on one machine: not a benchmark, not production evidence, and not a basis for any threshold by itself.",
      "Records counts and timings only; no response body, header, cookie, token or identifier.",
    ],
  };
}
