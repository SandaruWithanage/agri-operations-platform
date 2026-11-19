// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSecurityEvents,
  securityEventNames,
  securityReasons,
  securityRouteClasses,
  type SecurityEventInput,
} from "../packages/security-events/src";
import { createBffHandler } from "../packages/auth-bff/src";

const key = "synthetic-hash-key-0123456789abcdef-0123456789";
const secrets = [
  "hunter2-password",
  "123456-otp",
  "__Host-agri_session=SECRETCOOKIEVALUE",
  "Bearer eyJSECRETTOKEN",
  "synthetic-internal-key-with-at-least-43-characters",
  "Nimal Perado",
  "7.8731,80.7718",
  "199512345678",
  "203.0.113.77",
  "00000000-0000-4000-8000-0000000000aa",
];

function collector(options: Parameters<typeof createSecurityEvents>[0] = {}) {
  const lines: string[] = [];
  let clock = 1_763_530_000_000;
  const events = createSecurityEvents({
    sink: (line) => lines.push(line),
    hashKey: key,
    now: () => clock,
    ...options,
  });
  return {
    events,
    lines,
    parsed: () => lines.map((line) => JSON.parse(line)),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const base: SecurityEventInput = {
  event: "bff.ratelimit.exceeded",
  outcome: "refused",
  routeClass: "anonymous",
  reason: "client-budget",
};

describe("security events: privacy", () => {
  it("emits only the fixed fields, in a fixed order, with no free text", () => {
    const { events, parsed } = collector();
    events.emit({ ...base, client: "203.0.113.77" });
    const [line] = parsed();
    expect(Object.keys(line)).toEqual([
      "v",
      "event",
      "time",
      "outcome",
      "routeClass",
      "reason",
      "client",
    ]);
    expect(line.v).toBe(1);
    expect(line.time).toBe(new Date(1_763_530_000_000).toISOString());
  });

  it("never copies unknown fields through, even when a caller plants secrets in them", () => {
    const { events, lines } = collector();
    const hostile = {
      ...base,
      password: secrets[0],
      otp: secrets[1],
      cookie: secrets[2],
      authorization: secrets[3],
      internalKey: secrets[4],
      name: secrets[5],
      location: secrets[6],
      nic: secrets[7],
      address: secrets[8],
      accountId: secrets[9],
      message: "free text",
    } as unknown as SecurityEventInput;
    events.emit(hostile);
    const output = lines.join("\n");
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output).not.toContain("free text");
  });

  it("replaces account, client and device values with keyed hashes and never emits them raw", () => {
    const { events, lines, parsed } = collector();
    events.emit({
      ...base,
      account: secrets[9],
      client: secrets[8],
      device: "11111111-1111-4111-8111-111111111111",
    });
    const output = lines.join("\n");
    expect(output).not.toContain(secrets[9]);
    expect(output).not.toContain(secrets[8]);
    expect(output).not.toContain("11111111-1111-4111-8111-111111111111");
    const [line] = parsed();
    for (const field of ["account", "client", "device"])
      expect(line[field]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Separate keys per field: the same raw value does not correlate across fields.
    const same = collector();
    same.events.emit({ ...base, account: "x", client: "x" });
    const [a] = same.parsed();
    expect(a.account).not.toBe(a.client);
  });

  it("is deterministic for one key, differs for another, and omits identifiers without a usable key", () => {
    const one = collector();
    const two = collector();
    one.events.emit({ ...base, client: "203.0.113.77" });
    two.events.emit({ ...base, client: "203.0.113.77" });
    expect(one.parsed()[0].client).toBe(two.parsed()[0].client);
    const other = collector({ hashKey: key + "-different" });
    other.events.emit({ ...base, client: "203.0.113.77" });
    expect(other.parsed()[0].client).not.toBe(one.parsed()[0].client);
    for (const hashKey of [undefined, "", "too-short"]) {
      const bare = collector({ hashKey });
      bare.events.emit({ ...base, client: "203.0.113.77", account: "a" });
      const [line] = bare.parsed();
      expect(line.client).toBeUndefined();
      expect(line.account).toBeUndefined();
      expect(line.event).toBe("bff.ratelimit.exceeded");
    }
  });

  it("drops an event whose enumerated field is not on its list, and counts the drop", () => {
    const { events, lines } = collector();
    for (const bad of [
      { ...base, event: "auth.password.leak" },
      { ...base, outcome: "password=hunter2" },
      { ...base, routeClass: "/api/pilot/auth/login?otp=123456" },
      { ...base, reason: "user typed their NIC 199512345678" },
    ])
      events.emit(bad as unknown as SecurityEventInput);
    expect(lines).toEqual([]);
    expect(events.snapshot().dropped).toBe(4);
  });

  it("accepts configuration detail only as VARIABLE:reason codes and never a value", () => {
    const { events, parsed } = collector();
    events.emit({
      event: "config.unsafe.detected",
      outcome: "detected",
      reason: "unsafe-configuration",
      detail: [
        "PILOT_TRUSTED_PROXY_HOPS:missing",
        "PILOT_INTERNAL_KEY:too-short",
      ],
    });
    expect(parsed()[0].detail).toEqual([
      "PILOT_TRUSTED_PROXY_HOPS:missing",
      "PILOT_INTERNAL_KEY:too-short",
    ]);
    for (const detail of [
      ["PILOT_INTERNAL_KEY=synthetic-internal-key-with-at-least-43-characters"],
      ["pilot_internal_key:missing"],
      ["PILOT_INTERNAL_KEY:Too Short"],
      ["A:b", "A:b", "A:b", "A:b", "A:b", "A:b", "A:b", "A:b", "A:b"],
      [],
    ]) {
      events.emit({
        event: "config.unsafe.detected",
        outcome: "detected",
        reason: "unsafe-configuration",
        detail,
      });
    }
    expect(parsed()).toHaveLength(1);
    expect(events.snapshot().dropped).toBe(5);
    // Detail is only meaningful for the configuration event.
    events.emit({ ...base, detail: ["PILOT_INTERNAL_KEY:missing"] });
    expect(events.snapshot().dropped).toBe(6);
  });

  it("keeps closed lists free of anything that looks like a value", () => {
    for (const value of [
      ...securityEventNames,
      ...securityRouteClasses,
      ...securityReasons,
    ])
      expect(value).toMatch(/^[a-z][a-z.-]*$/);
  });
});

describe("security events: robustness and bounded volume", () => {
  it("never throws to the caller when the sink fails or input is garbage", () => {
    const failing = createSecurityEvents({
      hashKey: key,
      sink: () => {
        throw new Error("disk full");
      },
    });
    expect(() => failing.emit(base)).not.toThrow();
    expect(failing.snapshot().dropped).toBe(1);
    const events = createSecurityEvents({ hashKey: key });
    for (const garbage of [undefined, null, 5, "x", {}, []])
      expect(() =>
        events.emit(garbage as unknown as SecurityEventInput),
      ).not.toThrow();
  });

  it("coalesces a flood into one line with a count, while the counters count every occurrence", () => {
    const { events, parsed, advance } = collector({ coalesceMs: 10_000 });
    for (let i = 0; i < 500; i += 1) events.emit({ ...base, client: "c1" });
    expect(parsed()).toHaveLength(1);
    expect(parsed()[0].count).toBeUndefined();
    expect(events.snapshot().events["bff.ratelimit.exceeded|refused"]).toBe(
      500,
    );
    advance(10_001);
    events.emit({ ...base, client: "c1" });
    expect(parsed()).toHaveLength(2);
    expect(parsed()[1].count).toBe(500);
  });

  it("keeps different clients, reasons and route classes as separate coalescing keys", () => {
    const { events, parsed } = collector();
    events.emit({ ...base, client: "c1" });
    events.emit({ ...base, client: "c2" });
    events.emit({ ...base, client: "c1", reason: "unattributed-budget" });
    events.emit({ ...base, client: "c1", routeClass: "session-read" });
    expect(parsed()).toHaveLength(4);
  });

  it("bounds the memory used for coalescing under many distinct keys", () => {
    const { events, parsed } = collector({ maxKeys: 50, coalesceMs: 60_000 });
    for (let i = 0; i < 5_000; i += 1)
      events.emit({ ...base, client: `c${i}` });
    expect(parsed().length).toBe(5_000);
    expect(events.snapshot().events["bff.ratelimit.exceeded|refused"]).toBe(
      5_000,
    );
  });

  it("does not coalesce the one-off configuration event", () => {
    const { events, parsed } = collector();
    for (let i = 0; i < 3; i += 1)
      events.emit({
        event: "config.unsafe.detected",
        outcome: "detected",
        reason: "unsafe-configuration",
        detail: ["PILOT_TRUSTED_PROXY_HOPS:missing"],
      });
    expect(parsed()).toHaveLength(3);
  });

  it("keeps metrics low-cardinality: event and outcome only, never an identifier", () => {
    const { events } = collector();
    for (let i = 0; i < 20; i += 1)
      events.emit({ ...base, client: `203.0.113.${i}`, account: `a${i}` });
    expect(Object.keys(events.snapshot().events)).toEqual([
      "bff.ratelimit.exceeded|refused",
    ]);
  });
});

// ---- BFF integration: events fire and responses are unchanged -----------------------------------------------
const origin = "https://field.example.test";
const opaque = "A".repeat(43);
const csrf = `${"B".repeat(43)}.${"C".repeat(43)}`;
const bffConfig = {
  apiOrigin: "https://api.example.test",
  publicOrigin: origin,
  internalKey: "synthetic-internal-key-with-at-least-43-characters",
  source: "field_officer" as const,
};
function request(
  path: string,
  method = "GET",
  extra: Record<string, string> = {},
  withCookie = true,
) {
  return new Request(`${origin}/api/pilot/${path}`, {
    method,
    headers: {
      origin,
      ...(withCookie ? { cookie: `__Host-agri_session=${opaque}` } : {}),
      "x-csrf-token": csrf,
      ...extra,
    },
  });
}

describe("security events: BFF emission points", () => {
  it("emits a rate-limit event for an anonymous client, with a hashed address and an unchanged 429", async () => {
    const { events, lines, parsed } = collector();
    const handler = createBffHandler(
      {
        ...bffConfig,
        trustedProxyHops: 1,
        rateLimits: { anonymousPerClient: 2 },
        events,
      },
      vi.fn(),
    );
    const call = () =>
      handler(
        request(
          "auth/device-challenge",
          "POST",
          { "x-forwarded-for": "203.0.113.77" },
          false,
        ),
      );
    await call();
    await call();
    const refused = await call();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "Too many requests" });
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    const [line] = parsed();
    expect(line).toMatchObject({
      event: "bff.ratelimit.exceeded",
      outcome: "refused",
      routeClass: "anonymous",
      reason: "client-budget",
    });
    expect(line.client).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(lines.join("\n")).not.toContain("203.0.113.77");
  });

  it("classifies the shared unattributed bucket and session budgets separately", async () => {
    const shared = collector();
    const anonymous = createBffHandler(
      {
        ...bffConfig,
        rateLimits: { anonymousUnattributed: 1 },
        events: shared.events,
      },
      vi.fn(),
    );
    await anonymous(request("auth/device-challenge", "POST", {}, false));
    await anonymous(request("auth/device-challenge", "POST", {}, false));
    expect(shared.parsed()[0]).toMatchObject({
      routeClass: "anonymous",
      reason: "unattributed-budget",
    });
    expect(shared.parsed()[0].client).toBeUndefined();

    const session = collector();
    const reads = createBffHandler(
      { ...bffConfig, rateLimits: { sessionReads: 1 }, events: session.events },
      vi.fn().mockResolvedValue(Response.json({})),
    );
    await reads(request("farmers"));
    const refused = await reads(request("farmers"));
    expect(refused.status).toBe(429);
    expect(session.parsed()[0]).toMatchObject({
      routeClass: "session-read",
      reason: "session-budget",
    });
    const output = session.lines.join("\n");
    expect(output).not.toContain(opaque);
    expect(output).not.toContain("__Host-agri_session");
  });

  it("emits an origin event for a wrong origin and a cross-site fetch, and still answers 403", async () => {
    const { events, parsed } = collector({ coalesceMs: 0 });
    const handler = createBffHandler({ ...bffConfig, events }, vi.fn());
    const wrongOrigin = await handler(
      request("farmers", "GET", { origin: "https://evil.example" }),
    );
    const crossSite = await handler(
      request("farmers", "GET", { "sec-fetch-site": "cross-site" }),
    );
    expect(wrongOrigin.status).toBe(403);
    expect(crossSite.status).toBe(403);
    expect(parsed().map((line) => line.reason)).toEqual([
      "origin-mismatch",
      "cross-site-fetch",
    ]);
    expect(parsed().every((line) => line.event === "bff.origin.rejected")).toBe(
      true,
    );
    expect(JSON.stringify(parsed())).not.toContain("evil.example");
  });

  it("emits a CSRF event for a malformed token and does not echo it", async () => {
    const { events, parsed, lines } = collector();
    const handler = createBffHandler({ ...bffConfig, events }, vi.fn());
    const response = await handler(
      request("auth/logout", "POST", {
        "x-csrf-token": "synthetic-malformed-token-SECRETCSRF",
      }),
    );
    expect(response.status).toBe(403);
    expect(parsed()[0]).toMatchObject({
      event: "bff.csrf.rejected",
      reason: "csrf-format",
    });
    expect(lines.join("\n")).not.toContain("SECRETCSRF");
  });

  it("answers exactly as before when the emitter is broken", async () => {
    const broken = createSecurityEvents({
      sink: () => {
        throw new Error("sink down");
      },
      hashKey: key,
    });
    const handler = createBffHandler({ ...bffConfig, events: broken }, vi.fn());
    const response = await handler(
      request("farmers", "GET", { "sec-fetch-site": "cross-site" }),
    );
    expect(response.status).toBe(403);
    expect(broken.snapshot().dropped).toBe(1);
  });
});

describe("security events: wiring guards", () => {
  const root = join(__dirname, "..");
  it.each(["admin-web", "field-pwa"])(
    "%s reports an unsafe configuration as an event before it exits, with codes only",
    (app) => {
      const node = readFileSync(
        join(root, "apps", app, "instrumentation-node.ts"),
        "utf8",
      );
      expect(node).toContain('event: "config.unsafe.detected"');
      expect(node.indexOf("getSecurityEvents().emit")).toBeLessThan(
        node.indexOf("process.exit(1)"),
      );
      expect(node).toContain("`${p.variable}:${p.reason}`");
      expect(node).not.toMatch(/process\.env\[|\$\{process\.env/);
    },
  );
  it("documents the hash key without a value", () => {
    const env = readFileSync(join(root, ".env.example"), "utf8");
    expect(env).toMatch(/^SECURITY_EVENT_HASH_KEY=$/m);
  });
});
