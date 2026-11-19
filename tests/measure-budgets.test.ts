// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import {
  bodyFor,
  ceilings,
  disposableAcknowledgement,
  isLoopbackAddress,
  parseTarget,
  percentile,
  runPlan,
  summarise,
  validatePlan,
  // @ts-expect-error plain ESM script without type declarations
} from "../scripts/measure-budgets-lib.mjs";

type Plan = {
  problems: string[];
  gates: string[];
  runnable: boolean;
  plan?: Record<string, unknown>;
};
const validate = validatePlan as (
  input: Record<string, unknown>,
  env?: Record<string, string>,
) => Plan;
const target = parseTarget as (text: string) => {
  ok: boolean;
  reason?: string;
  origin?: string;
};
const loopback = isLoopbackAddress as (a: unknown) => boolean;

const gatesOpen = {
  authorised: true,
  authorisationRef: "owner-ticket-001",
};
const ack = { MEASURE_DISPOSABLE_STACK: disposableAcknowledgement as string };

describe("measurement harness: target guard", () => {
  it("accepts only an http origin on loopback", () => {
    for (const ok of [
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://[::1]:3000",
      "http://127.0.0.1",
    ])
      expect(target(ok).ok, ok).toBe(true);
  });

  it("refuses every other target, including lookalikes and tricks", () => {
    const bad = [
      "https://127.0.0.1:3000",
      "http://127.0.0.1.example.test",
      "http://localhost.example.test",
      "http://example.test",
      "http://10.0.0.5:3000",
      "http://192.168.1.10",
      "http://0.0.0.0:3000",
      "http://user:pass@127.0.0.1:3000",
      "http://127.0.0.1@example.test",
      "http://127.0.0.1:3000/health",
      "http://127.0.0.1:3000/?x=1",
      "http://127.0.0.1:3000/#frag",
      "ftp://127.0.0.1",
      "not a url",
      "",
    ];
    for (const text of bad) expect(target(text).ok, text).toBe(false);
  });

  it("recognises loopback peers, including the IPv4-mapped form, and nothing else", () => {
    for (const ok of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"])
      expect(loopback(ok), ok).toBe(true);
    for (const bad of [
      "10.0.0.1",
      "203.0.113.7",
      "::ffff:10.0.0.1",
      "fe80::1",
      "",
      undefined,
      null,
      5,
    ])
      expect(loopback(bad), String(bad)).toBe(false);
  });
});

describe("measurement harness: plan and gates", () => {
  const base = {
    target: "http://127.0.0.1:3000",
    scenario: "ops-burst",
    requests: 100,
    concurrency: 4,
    durationMs: 30000,
  };

  it("has fixed literal ceilings that cannot be raised, whatever the constant says", () => {
    expect(Object.isFrozen(ceilings)).toBe(true);
    expect({ ...ceilings }).toEqual({
      requests: 5000,
      concurrency: 64,
      durationMs: 60000,
      requestTimeoutMs: 10000,
      bodyBytes: 65536,
    });
    expect(
      validate({ ...base, requests: 5001, concurrency: 4 }).problems.length,
    ).toBeGreaterThan(0);
    expect(
      validate({ ...base, requests: 5000, concurrency: 65 }).problems.length,
    ).toBeGreaterThan(0);
    expect(
      validate({ ...base, durationMs: 60001 }).problems.length,
    ).toBeGreaterThan(0);
    expect(
      validate({ ...base, requests: 5000, concurrency: 64, durationMs: 60000 })
        .problems,
    ).toEqual([]);
  });

  it("refuses to run when only the authorisation flag is missing", () => {
    const withReference = { ...base, authorisationRef: "owner-ticket-001" };
    const refused = validate({ ...withReference, authorised: false }, ack);
    expect(refused.runnable).toBe(false);
    expect(refused.gates.join(" ")).toContain("authorisation flag");
    expect(validate({ ...withReference, authorised: true }, ack).runnable).toBe(
      true,
    );
  });

  it("never accepts a value above a ceiling, and the ceilings are frozen", () => {
    expect(Object.isFrozen(ceilings)).toBe(true);
    for (const patch of [
      { requests: ceilings.requests + 1 },
      { concurrency: ceilings.concurrency + 1, requests: ceilings.requests },
      { durationMs: ceilings.durationMs + 1 },
      { requests: 0 },
      { concurrency: 0 },
      { requests: 1.5 },
      { requests: "abc" },
      { concurrency: 10, requests: 5 },
    ])
      expect(
        validate({ ...base, ...patch }).problems.length,
        JSON.stringify(patch),
      ).toBeGreaterThan(0);
    expect(
      validate({
        ...base,
        requests: ceilings.requests,
        concurrency: ceilings.concurrency,
      }).problems,
    ).toEqual([]);
  });

  it("refuses an unknown scenario and a non-loopback target", () => {
    expect(
      validate({ ...base, scenario: "login-everything" }).problems,
    ).toContain("unknown scenario");
    expect(
      validate({ ...base, target: "http://example.test" }).problems.length,
    ).toBeGreaterThan(0);
  });

  it("fixes the path and method per scenario; the caller cannot choose a path", () => {
    const result = validate(
      { ...base, path: "/admin/secret", ...gatesOpen },
      ack,
    );
    expect(result.plan?.path).toBe("/health");
    expect(result.plan?.method).toBe("GET");
  });

  it("is a dry run unless every gate is satisfied", () => {
    expect(validate(base, ack).runnable).toBe(false);
    expect(validate({ ...base, ...gatesOpen }, {}).runnable).toBe(false);
    expect(
      validate(
        { ...base, authorised: true, authorisationRef: "has spaces!" },
        ack,
      ).runnable,
    ).toBe(false);
    expect(validate({ ...base, authorised: true }, ack).runnable).toBe(false);
    expect(
      validate({ ...base, ...gatesOpen }, { ...ack, NODE_ENV: "production" })
        .runnable,
    ).toBe(false);
    expect(validate({ ...base, ...gatesOpen }, ack).runnable).toBe(true);
  });

  it("limits the oversize-body scenario to a few requests", () => {
    expect(
      validate({ ...base, scenario: "oversize-body", requests: 21 }).problems
        .length,
    ).toBeGreaterThan(0);
    expect(
      validate({
        ...base,
        scenario: "oversize-body",
        requests: 5,
        concurrency: 1,
      }).problems,
    ).toEqual([]);
  });

  it("uses only fixed synthetic bodies and an over-cap body for the cap scenario", () => {
    const login = String(bodyFor("anon-auth-burst", 3));
    expect(login).toContain("synthetic-wrong-password");
    expect(login).not.toMatch(/@|nic|bank/i);
    expect(String(bodyFor("oversize-body", 0)).length).toBeGreaterThan(16384);
    expect(bodyFor("ops-burst", 0)).toBeUndefined();
  });

  it("computes percentiles and a summary of counts and timings only", () => {
    expect(
      (percentile as (v: number[], p: number) => number | null)([], 50),
    ).toBeNull();
    const out = (
      summarise as (
        s: unknown[],
        a: number,
        b: number,
      ) => Record<string, unknown>
    )(
      [
        { status: 200, ms: 5 },
        { status: 200, ms: 7 },
        { status: 429, ms: 9 },
        { error: "timeout", ms: 10000 },
      ],
      0,
      2000,
    );
    expect(out.sent).toBe(4);
    expect(out.byStatus).toEqual({ 200: 2, 429: 1 });
    expect(out.errors).toEqual({ timeout: 1 });
    expect(out.refused).toBe(1);
    expect(out.latencyMs.max).toBe(10000);
  });
});

// ---- the command line, against a tiny local server --------------------------------------------------------
let server: Server | undefined;
afterEach(() => server?.close());

async function stub(statusFor: (n: number) => number) {
  const seen = {
    requests: 0,
    maxConcurrent: 0,
    current: 0,
    lengths: [] as number[],
    paths: new Set<string>(),
  };
  server = createServer((req, res) => {
    seen.requests += 1;
    const arrival = seen.requests;
    seen.current += 1;
    seen.maxConcurrent = Math.max(seen.maxConcurrent, seen.current);
    seen.paths.add(`${req.method} ${req.url}`);
    seen.lengths.push(Number(req.headers["content-length"] ?? 0));
    req.resume();
    setTimeout(() => {
      seen.current -= 1;
      res.writeHead(statusFor(arrival), {
        "Set-Cookie": "session=SECRET-COOKIE-VALUE",
      });
      res.end("SECRET-RESPONSE-BODY-MARKER");
    }, 5);
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  const address = server!.address();
  return {
    seen,
    url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
  };
}

function cli(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn("node", ["scripts/measure-budgets.mjs", ...args], {
      cwd: resolve(__dirname, ".."),
      env: { ...process.env, NODE_ENV: "test", ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => done({ code, out }));
  });
}

describe("measurement harness: runtime peer check", () => {
  it("stops at once, recording nothing, when a connection is not to a loopback address", async () => {
    let calls = 0;
    const transport = (
      _options: unknown,
      onResponse: (res: unknown) => void,
    ) => {
      calls += 1;
      const handlers: Record<string, (...a: unknown[]) => void> = {};
      return {
        on: (name: string, fn: (...a: unknown[]) => void) => {
          handlers[name] = fn;
        },
        write: () => undefined,
        end: () => {
          onResponse({
            socket: { remoteAddress: "203.0.113.9" },
            statusCode: 200,
            resume: () => undefined,
            destroy: () => undefined,
            on: () => undefined,
          });
        },
        destroy: () => undefined,
      };
    };
    const plan = validate(
      {
        target: "http://localhost:3000",
        scenario: "ops-burst",
        requests: 50,
        concurrency: 5,
        durationMs: 5000,
        ...gatesOpen,
      },
      ack,
    ).plan;
    const report = await (
      runPlan as (
        p: unknown,
        t: unknown,
      ) => Promise<{ stoppedEarly: string | null; result: { sent: number } }>
    )(plan, transport);
    expect(report.stoppedEarly).toBe("non-loopback peer");
    expect(report.result.sent).toBe(0);
    expect(calls).toBeLessThanOrEqual(5); // only the first wave of concurrent requests, never all 50
  });
});

describe("measurement harness: command line", () => {
  it("is a dry run by default: it prints the plan and opens no connection", async () => {
    const { seen, url } = await stub(() => 200);
    const result = await cli([
      "--target",
      url,
      "--scenario",
      "ops-burst",
      "--requests",
      "50",
      "--concurrency",
      "5",
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("DRY RUN");
    expect(seen.requests).toBe(0);
  });

  it("refuses a real run that lacks a gate, and opens no connection", async () => {
    const { seen, url } = await stub(() => 200);
    for (const [args, env] of [
      [["--run"], {}],
      [["--run", "--authorised"], ack],
      [["--run", "--authorised", "--ref", "t-1"], {}],
    ] as const) {
      const result = await cli(
        [
          "--target",
          url,
          "--scenario",
          "ops-burst",
          "--requests",
          "10",
          "--concurrency",
          "2",
          ...args,
        ],
        env as Record<string, string>,
      );
      expect(result.code).toBe(2);
    }
    const production = await cli(
      [
        "--target",
        url,
        "--scenario",
        "ops-burst",
        "--requests",
        "10",
        "--concurrency",
        "2",
        "--run",
        "--authorised",
        "--ref",
        "t-1",
      ],
      { ...ack, NODE_ENV: "production" },
    );
    expect(production.code).toBe(2);
    expect(seen.requests).toBe(0);
  });

  it("refuses a non-loopback target and unknown options", async () => {
    expect(
      (
        await cli(
          [
            "--target",
            "http://example.test",
            "--scenario",
            "ops-burst",
            "--run",
            "--authorised",
            "--ref",
            "t-1",
          ],
          ack,
        )
      ).code,
    ).toBe(2);
    expect(
      (
        await cli([
          "--target",
          "http://127.0.0.1:1",
          "--scenario",
          "ops-burst",
          "--path",
          "/x",
        ])
      ).code,
    ).toBe(2);
    expect(
      (
        await cli([
          "--target",
          "http://127.0.0.1:1",
          "--scenario",
          "ops-burst",
          "extra",
        ])
      ).code,
    ).toBe(2);
  });

  it("runs exactly the planned requests within the concurrency, and records counts and timings only", async () => {
    const { seen, url } = await stub((n) => (n % 4 === 0 ? 429 : 200));
    const result = await cli(
      [
        "--target",
        url,
        "--scenario",
        "ops-burst",
        "--requests",
        "40",
        "--concurrency",
        "8",
        "--run",
        "--authorised",
        "--ref",
        "owner-ticket-001",
      ],
      ack,
    );
    expect(result.code).toBe(0);
    expect(seen.requests).toBe(40);
    expect(seen.maxConcurrent).toBeLessThanOrEqual(8);
    expect([...seen.paths]).toEqual(["GET /health"]);
    const report = JSON.parse(result.out);
    expect(report.result.sent).toBe(40);
    expect(report.result.refused).toBe(10);
    expect(report.plan.authorisationRef).toBe("owner-ticket-001");
    expect(result.out).not.toContain("SECRET-RESPONSE-BODY-MARKER");
    expect(result.out).not.toContain("SECRET-COOKIE-VALUE");
    expect(report.notes.join(" ")).toContain("not a benchmark");
  });

  it("sends only the fixed login path and synthetic body for the anonymous scenario, and an over-cap body for the cap scenario", async () => {
    const first = await stub(() => 401);
    const anon = await cli(
      [
        "--target",
        first.url,
        "--scenario",
        "anon-auth-burst",
        "--requests",
        "12",
        "--concurrency",
        "3",
        "--run",
        "--authorised",
        "--ref",
        "t-2",
      ],
      ack,
    );
    expect(anon.code).toBe(0);
    expect([...first.seen.paths]).toEqual(["POST /api/pilot/auth/login"]);
    server?.close();
    const second = await stub(() => 413);
    const over = await cli(
      [
        "--target",
        second.url,
        "--scenario",
        "oversize-body",
        "--requests",
        "3",
        "--concurrency",
        "1",
        "--run",
        "--authorised",
        "--ref",
        "t-3",
      ],
      ack,
    );
    expect(over.code).toBe(0);
    expect(Math.min(...second.seen.lengths)).toBeGreaterThan(16384);
  });
});
