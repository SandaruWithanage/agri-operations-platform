// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createBffHandler } from "../packages/auth-bff/src";
const origin = "https://field.example.test";
const opaque = "A".repeat(43);
const csrf = `${"B".repeat(43)}.${"C".repeat(43)}`;
const internal = "synthetic-internal-key-with-at-least-43-characters";
const config = {
  apiOrigin: "https://api.example.test",
  publicOrigin: origin,
  internalKey: internal,
  source: "field_officer" as const,
};
const cookie = `__Host-agri_session=${opaque}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`;
function req(
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return new Request(`${origin}/api/pilot/${path}`, {
    method,
    headers: {
      origin,
      cookie: `__Host-agri_session=${opaque}`,
      "x-csrf-token": csrf,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
describe("server-only authentication BFF", () => {
  it("keeps the opaque session in a secure cookie and strips it from the login response", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ cookie }));
    const handler = createBffHandler(config, fetcher);
    const response = await handler(
      req("auth/login", "POST", {
        loginName: "synthetic",
        password: "synthetic",
        otp: "123456",
        deviceId: "synthetic",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe(cookie);
    expect(await response.json()).toEqual({ signedIn: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetcher.mock.calls[0][1].headers["x-agri-bff-key"]).toBe(internal);
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it("rejects foreign origins, missing CSRF and duplicate cookies before forwarding a request", async () => {
    const fetcher = vi.fn();
    const handler = createBffHandler(config, fetcher);
    expect(
      (
        await handler(
          req(
            "auth/login",
            "POST",
            {},
            { origin: "https://attacker.example.test" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler(
          req("farmers/register", "POST", {}, { "x-csrf-token": "" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler(
          req("auth/csrf", "GET", undefined, {
            cookie: `__Host-agri_session=${opaque}; __Host-agri_session=${opaque}`,
          }),
        )
      ).status,
    ).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("exchanges the cookie for a JWT server-side and returns only registration fields", async () => {
    const id = "06149451-4004-4a23-a5a2-64a24e485a82";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ accessToken: "private-jwt" }))
      .mockResolvedValueOnce(
        Response.json({
          status: "synced",
          farmerId: id,
          replayed: false,
          accessToken: "should-never-leak",
        }),
      );
    const response = await createBffHandler(
      config,
      fetcher,
    )(req("farmers/register", "POST", { mutationId: "synthetic" }));
    expect(await response.json()).toEqual({
      status: "synced",
      farmerId: id,
      replayed: false,
    });
    expect(fetcher.mock.calls[0][1].headers["x-agri-session"]).toBe(opaque);
    expect(fetcher.mock.calls[1][1].headers.authorization).toBe(
      "Bearer private-jwt",
    );
    expect(fetcher.mock.calls[1][1].headers["x-agri-source"]).toBe(
      "field_officer",
    );
  });
  it("never exposes token minting as a browser route and sanitizes upstream errors", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("private database info", { status: 500 }),
      );
    const handler = createBffHandler(config, fetcher);
    expect((await handler(req("auth/token", "POST", {}))).status).toBe(404);
    const response = await handler(req("auth/csrf"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
  it("clears a revoked session locally while rejecting malformed login cookies", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const response = await createBffHandler(
      config,
      fetcher,
    )(req("auth/logout", "POST"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const bad = vi
      .fn()
      .mockResolvedValue(
        Response.json({ cookie: "malicious\r\nHeader: value" }),
      );
    expect(
      (await createBffHandler(config, bad)(req("auth/login", "POST", {})))
        .status,
    ).toBe(503);
  });
  it("returns only the safe account identity with a session-bound CSRF token", async () => {
    const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        accountId,
        csrfToken: csrf,
        sessionId: "private",
        secret: opaque,
      }),
    );
    const response = await createBffHandler(config, fetcher)(req("auth/csrf"));
    expect(await response.json()).toEqual({ accountId, csrfToken: csrf });
    const malformed = vi
      .fn()
      .mockResolvedValue(Response.json({ csrfToken: csrf }));
    expect(
      (await createBffHandler(config, malformed)(req("auth/csrf"))).status,
    ).toBe(503);
  });
  it("bounds browser request bodies and rejects insecure production configuration", async () => {
    const fetcher = vi.fn();
    expect(
      (
        await createBffHandler(
          config,
          fetcher,
        )(req("auth/login", "POST", { password: "a".repeat(20000) }))
      ).status,
    ).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
    expect(() =>
      createBffHandler({ ...config, apiOrigin: "http://api.example.test" }),
    ).toThrow();
    expect(() =>
      createBffHandler({
        ...config,
        publicOrigin: "https://field.example.test/path",
      }),
    ).toThrow();
  });
});
