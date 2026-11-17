// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression for issue #72: the rate limiter lives inside the BFF handler, and the Next.js route used to build a
 * new handler on every request, so no budget ever accumulated. These tests call the real exported route handlers
 * (not `createBffHandler` directly) many times, for both apps.
 */
const origin = "https://app.example.test";
const cookie =
  "__Host-agri_session=" +
  "A".repeat(43) +
  "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=60";
const login = {
  loginName: "synthetic",
  password: "synthetic",
  otp: "123456",
  deviceId: "synthetic",
};
const routes = {
  "field PWA": () => import("../apps/field-pwa/app/api/pilot/[...path]/route"),
  "admin web": () => import("../apps/admin-web/app/api/pilot/[...path]/route"),
} as const;

function configure() {
  vi.stubEnv("PILOT_API_ORIGIN", "http://127.0.0.1:9");
  vi.stubEnv("PILOT_PUBLIC_ORIGIN", origin);
  vi.stubEnv("PILOT_INTERNAL_KEY", "k".repeat(48));
  vi.stubEnv("PILOT_TRUSTED_PROXY_HOPS", "1");
}
const attempt = (
  route: { POST: (request: Request) => Promise<Response> },
  address: string,
) =>
  route.POST(
    new Request(`${origin}/api/pilot/auth/login`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-forwarded-for": address,
      },
      body: JSON.stringify(login),
    }),
  );

let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  upstream = vi.fn().mockImplementation(async () => Response.json({ cookie }));
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(Object.entries(routes))("%s route entrypoint", (_name, load) => {
  it("keeps one rate limiter across requests: 429 after the budget, with Retry-After and no upstream call", async () => {
    configure();
    const route = await load();
    for (let i = 0; i < 30; i += 1)
      expect((await attempt(route, "203.0.113.9")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(30);
    const limited = await attempt(route, "203.0.113.9");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(
      1,
    );
    expect(await limited.json()).toEqual({ error: "Too many requests" });
    expect(upstream).toHaveBeenCalledTimes(30);
    // Another client address has its own budget.
    expect((await attempt(route, "203.0.113.10")).status).toBe(200);
  });

  it("answers 503 without caching the failure, so fixing the configuration takes effect without a restart", async () => {
    const route = await load();
    const unconfigured = await attempt(route, "203.0.113.9");
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.headers.get("cache-control")).toBe("no-store");
    expect(await unconfigured.json()).toEqual({
      error: "Authentication is not configured",
    });
    expect(upstream).not.toHaveBeenCalled();
    configure();
    expect((await attempt(route, "203.0.113.9")).status).toBe(200);
    // A later bad value does not retroactively break the already-built handler or reset its counters.
    vi.stubEnv("PILOT_INTERNAL_KEY", "");
    expect((await attempt(route, "203.0.113.9")).status).toBe(200);
  });
});
