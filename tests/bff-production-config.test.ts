import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertProductionBffEnvironment,
  productionBffProblems,
} from "../packages/auth-bff/src/production-config";

const key = "k".repeat(43);
const good = {
  NODE_ENV: "production",
  PILOT_API_ORIGIN: "https://api.internal.example",
  PILOT_PUBLIC_ORIGIN: "https://staff.example",
  PILOT_INTERNAL_KEY: key,
  PILOT_TRUSTED_PROXY_HOPS: "1",
};
const without = (name: string) => {
  const copy: Record<string, string | undefined> = { ...good };
  delete copy[name];
  return copy;
};
const reasons = (env: Record<string, string | undefined>) =>
  productionBffProblems(env).map((p) => `${p.variable}:${p.reason}`);

describe("production BFF start-up checks (SEC-A1)", () => {
  it("accepts a complete, explicit production configuration", () => {
    expect(productionBffProblems(good)).toEqual([]);
    expect(() => assertProductionBffEnvironment(good)).not.toThrow();
  });

  it("leaves development and test environments alone", () => {
    expect(productionBffProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(
      productionBffProblems({
        ...good,
        NODE_ENV: "development",
        PILOT_TRUSTED_PROXY_HOPS: "",
      }),
    ).toEqual([]);
  });

  it("leaves a production build with no BFF settings at all alone (BFF answers 503 not configured)", () => {
    expect(productionBffProblems({ NODE_ENV: "production" })).toEqual([]);
    expect(
      productionBffProblems({
        NODE_ENV: "production",
        PILOT_API_ORIGIN: "",
        ENABLE_PILOT_AUTH: "false",
      }),
    ).toEqual([]);
  });

  it("refuses an unset proxy hop count when anything else is configured", () => {
    expect(reasons(without("PILOT_TRUSTED_PROXY_HOPS"))).toEqual([
      "PILOT_TRUSTED_PROXY_HOPS:missing",
    ]);
    expect(reasons({ ...good, PILOT_TRUSTED_PROXY_HOPS: "  " })).toEqual([
      "PILOT_TRUSTED_PROXY_HOPS:missing",
    ]);
  });

  it.each(["abc", "1.5", "-1", "1e1", "0x2", "１"])(
    "refuses a hop count that is not a plain non-negative integer: %s",
    (value) => {
      expect(reasons({ ...good, PILOT_TRUSTED_PROXY_HOPS: value })).toEqual([
        "PILOT_TRUSTED_PROXY_HOPS:not-an-integer",
      ]);
    },
  );

  it("refuses a hop count above the supported range", () => {
    expect(reasons({ ...good, PILOT_TRUSTED_PROXY_HOPS: "6" })).toEqual([
      "PILOT_TRUSTED_PROXY_HOPS:out-of-range",
    ]);
    expect(
      productionBffProblems({ ...good, PILOT_TRUSTED_PROXY_HOPS: "5" }),
    ).toEqual([]);
  });

  it("allows zero hops in production only with an explicit acknowledgement", () => {
    const zero = { ...good, PILOT_TRUSTED_PROXY_HOPS: "0" };
    expect(reasons(zero)).toEqual([
      "PILOT_TRUSTED_PROXY_HOPS:unattributed-needs-acknowledgement",
    ]);
    expect(
      reasons({ ...zero, PILOT_ACCEPT_UNATTRIBUTED_CLIENTS: "yes" }),
    ).toHaveLength(1);
    expect(
      productionBffProblems({
        ...zero,
        PILOT_ACCEPT_UNATTRIBUTED_CLIENTS: "true",
      }),
    ).toEqual([]);
  });

  it.each([
    ["http://api.internal.example", "PILOT_API_ORIGIN"],
    ["https://api.internal.example/path", "PILOT_API_ORIGIN"],
    ["https://user:pw@api.internal.example", "PILOT_API_ORIGIN"],
    ["not a url", "PILOT_API_ORIGIN"],
    ["http://staff.example", "PILOT_PUBLIC_ORIGIN"],
    ["https://staff.example/", "PILOT_PUBLIC_ORIGIN"],
  ])("refuses an origin that is not a bare https origin: %s", (value, name) => {
    expect(reasons({ ...good, [name]: value })).toEqual([
      `${name}:not-https-origin`,
    ]);
  });

  it("refuses a missing origin or internal key and a short key", () => {
    expect(reasons(without("PILOT_API_ORIGIN"))).toEqual([
      "PILOT_API_ORIGIN:missing",
    ]);
    expect(reasons(without("PILOT_PUBLIC_ORIGIN"))).toEqual([
      "PILOT_PUBLIC_ORIGIN:missing",
    ]);
    expect(reasons(without("PILOT_INTERNAL_KEY"))).toEqual([
      "PILOT_INTERNAL_KEY:missing",
    ]);
    expect(reasons({ ...good, PILOT_INTERNAL_KEY: "k".repeat(42) })).toEqual([
      "PILOT_INTERNAL_KEY:too-short",
    ]);
  });

  it("reports every problem together so one restart fixes them all", () => {
    expect(
      reasons({
        NODE_ENV: "production",
        PILOT_API_ORIGIN: "http://x",
        PILOT_INTERNAL_KEY: "short",
      }).sort(),
    ).toEqual(
      [
        "PILOT_API_ORIGIN:not-https-origin",
        "PILOT_INTERNAL_KEY:too-short",
        "PILOT_PUBLIC_ORIGIN:missing",
        "PILOT_TRUSTED_PROXY_HOPS:missing",
      ].sort(),
    );
  });

  it("never prints a value, including the secret internal key", () => {
    const secret = "S3cr3t-".repeat(8);
    let message = "";
    try {
      assertProductionBffEnvironment({
        NODE_ENV: "production",
        PILOT_API_ORIGIN: "http://leaky.example",
        PILOT_INTERNAL_KEY: secret,
        PILOT_TRUSTED_PROXY_HOPS: "9",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("Unsafe production BFF configuration");
    expect(message).toContain("PILOT_TRUSTED_PROXY_HOPS (out-of-range)");
    expect(message).not.toContain(secret);
    expect(message).not.toContain("leaky.example");
  });

  it.each(["admin-web", "field-pwa"])(
    "%s checks at server start (not during the build) and exits non-zero without printing values",
    (app) => {
      const read = (name: string) =>
        readFileSync(join(__dirname, "..", "apps", app, name), "utf8");
      const hook = read("instrumentation.ts");
      expect(hook).toContain('process.env.NEXT_RUNTIME === "nodejs"');
      expect(hook).toContain('!== "phase-production-build"');
      expect(hook).toContain('import("./instrumentation-node")');
      const node = read("instrumentation-node.ts");
      expect(node).toContain("productionBffProblems(process.env)");
      expect(node).toContain("process.exit(1)");
      // Variable names and reason codes only: never interpolate a value.
      expect(node).not.toMatch(/process\.env\[|\$\{process\.env/);
    },
  );
});
