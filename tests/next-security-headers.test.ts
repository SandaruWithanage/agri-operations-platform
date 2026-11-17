import { afterEach, describe, expect, it } from "vitest";
import field from "../apps/field-pwa/next.config";
import admin from "../apps/admin-web/next.config";

type Rule = { source: string; headers: { key: string; value: string }[] };
const original = process.env.NODE_ENV;
afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = original;
});
async function rules(config: { headers: () => Promise<Rule[]> }, env: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = env;
  return config.headers();
}
const all = (list: Rule[]) =>
  Object.fromEntries(
    list
      .find((rule) => rule.source === "/:path*")!
      .headers.map((h) => [h.key, h.value]),
  );

describe("frontend security headers", () => {
  it.each([
    ["field PWA", field, "geolocation=(self)"],
    ["admin web", admin, "geolocation=()"],
  ])(
    "%s applies a same-origin policy to every route in production",
    async (_name, config, geo) => {
      const headers = all(await rules(config as never, "production"));
      const csp = headers["Content-Security-Policy"];
      for (const directive of [
        "default-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "worker-src 'self'",
      ])
        expect(csp.split("; ")).toContain(directive);
      expect(csp).not.toContain("unsafe-eval");
      expect(csp).not.toMatch(/\bws:|wss:|\*|http:/);
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Referrer-Policy"]).toBe("no-referrer");
      expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
      expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
      expect(headers["Permissions-Policy"]).toContain(geo);
      expect(headers["Permissions-Policy"]).toContain("camera=()");
      expect(headers["Permissions-Policy"]).toContain("microphone=()");
      expect(headers["Strict-Transport-Security"]).toBe(
        "max-age=31536000; includeSubDomains",
      );
      expect((config as { poweredByHeader: boolean }).poweredByHeader).toBe(
        false,
      );
    },
  );

  it("relaxes only what development tooling needs and never sends HSTS outside production", async () => {
    const headers = all(await rules(field as never, "development"));
    expect(headers["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(headers["Content-Security-Policy"]).toContain(
      "connect-src 'self' ws: wss:",
    );
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("keeps the public offline shell marker on the field app only", async () => {
    const list = await rules(field as never, "production");
    expect(
      list.find((rule) => rule.source === "/offline-workspace")?.headers,
    ).toEqual([{ key: "X-Agri-Public-Shell", value: "1" }]);
    const adminList = await rules(admin as never, "production");
    expect(
      adminList.find((rule) => rule.source === "/offline-workspace"),
    ).toBeUndefined();
  });
});
