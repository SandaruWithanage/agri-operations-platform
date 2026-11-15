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
        deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
        sessionId: "private",
        secret: opaque,
      }),
    );
    const response = await createBffHandler(config, fetcher)(req("auth/csrf"));
    expect(await response.json()).toEqual({
      accountId,
      csrfToken: csrf,
      deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
    });
    const malformed = vi
      .fn()
      .mockResolvedValue(Response.json({ csrfToken: csrf }));
    expect(
      (await createBffHandler(config, malformed)(req("auth/csrf"))).status,
    ).toBe(503);
  });
  it("exposes only public device challenges with origin checks and no cookie requirement", async () => {
    const value = {
      nonce: "A".repeat(43),
      mac: "B".repeat(43),
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    };
    const network = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...value, privateKey: "never expose" }),
      );
    const handler = createBffHandler(config, network);
    const response = await handler(
      req(
        "auth/device-challenge",
        "POST",
        { loginName: "synthetic", deviceId: "synthetic" },
        { cookie: "" },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(value);
    expect(network.mock.calls[0][1].headers["x-agri-origin"]).toBe(origin);
    expect(
      (
        await handler(
          req(
            "auth/device-challenge",
            "POST",
            {},
            { origin: "https://attacker.example.test" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(network).toHaveBeenCalledOnce();
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

it("returns only an actor-bound drafting context and no upstream role/token/record data", async () => {
  const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
    deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86",
    geographyId = "4e743f19-e3f7-4ed0-bdcc-29fe8e71ff0d";
  const value = {
    accountId,
    deviceId,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: Date.now(),
    offlineUntil: Date.now() + 3600000,
    geographies: [{ id: geographyId, name: "Synthetic village" }],
  };
  const network = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only" }))
    .mockResolvedValueOnce(
      Response.json({
        ...value,
        roles: ["not-authoritative"],
        farmers: ["never cache"],
        accessToken: "private",
      }),
    );
  const response = await createBffHandler(
    config,
    network,
  )(req("registration/context"));
  expect(await response.json()).toEqual(value);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(network.mock.calls[1][1].headers.authorization).toBe(
    "Bearer server-only",
  );
});

it("forwards only bounded registry queries and strips non-public response fields", async () => {
  const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
  const farmer = {
    id: "06149451-4004-4a23-a5a2-64a24e485a82",
    fullName: "Synthetic registry",
    geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
    geographyName: "Synthetic village",
    status: "pending-review",
    createdAt: "2026-11-15T10:00:00.000Z",
    version: 1,
    duplicateRisk: false,
  };
  const network = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(
      Response.json({
        accountId,
        items: [{ ...farmer, nic: "synthetic-sensitive-extra" }],
        nextCursor: null,
        secret: "synthetic-secret",
      }),
    );
  const reply = await createBffHandler(config, network)(req("farmers?limit=1"));
  expect(reply.status).toBe(200);
  expect(reply.headers.get("cache-control")).toBe("no-store");
  expect(await reply.json()).toEqual({
    accountId,
    items: [farmer],
    nextCursor: null,
  });
  expect(String(network.mock.calls[1][0])).toBe(
    "https://api.example.test/pilot/farmers?limit=1",
  );
  expect(network.mock.calls[1][1].headers.authorization).toBe(
    "Bearer server-only-jwt",
  );
  for (const query of [
    "limit=101",
    "accountId=" + accountId,
    "limit=1&limit=2",
    "after=invalid",
  ]) {
    const calls = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: "server-only-jwt" }));
    expect(
      (await createBffHandler(config, calls)(req("farmers?" + query))).status,
    ).toBe(400);
    expect(calls).toHaveBeenCalledTimes(1);
  }
});
it("does not distinguish unavailable registry records from nonexistent ones", async () => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  const reply = await createBffHandler(
    config,
    network,
  )(req("farmers/detail?id=06149451-4004-4a23-a5a2-64a24e485a82"));
  expect(reply.status).toBe(404);
  expect(await reply.json()).toEqual({ error: "Not found" });
});

it("requires CSRF and a strict versioned body for farmer changes and sanitizes its result", async () => {
  const farmerId = "06149451-4004-4a23-a5a2-64a24e485a82";
  const input = {
    mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
    farmerId,
    expectedVersion: 1,
    action: "verification",
    reason: "Synthetic staff record review",
  };
  const denied = vi.fn();
  expect(
    (
      await createBffHandler(
        config,
        denied,
      )(req("farmers/change", "POST", input, { "x-csrf-token": "" }))
    ).status,
  ).toBe(403);
  expect(denied).not.toHaveBeenCalled();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(
      Response.json({
        farmerId,
        version: 2,
        replayed: false,
        duplicateRisk: false,
        actorSecret: "synthetic-extra",
      }),
    );
  const response = await createBffHandler(
    config,
    fetcher,
  )(req("farmers/change", "POST", input));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    farmerId,
    version: 2,
    replayed: false,
    duplicateRisk: false,
  });
  expect(fetcher.mock.calls[1][1].headers["x-csrf-token"]).toBe(csrf);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(input);
  const invalid = vi
    .fn()
    .mockResolvedValue(Response.json({ accessToken: "server-only-jwt" }));
  expect(
    (
      await createBffHandler(
        config,
        invalid,
      )(req("farmers/change", "POST", { ...input, accountId: farmerId }))
    ).status,
  ).toBe(400);
  expect(invalid).toHaveBeenCalledTimes(1);
});
