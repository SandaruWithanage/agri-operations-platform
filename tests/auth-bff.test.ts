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
const adminConfig = { ...config, source: "administrator" as const };
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

it("keeps history server tokens private, sanitizes events and rejects partial cursor/scope injection", async () => {
  const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
    farmerId = "06149451-4004-4a23-a5a2-64a24e485a82";
  const event = {
    eventId: farmerId,
    occurredAt: "2026-11-15T12:00:00.123457Z",
    actorAccountId: accountId,
    action: "registration",
    change: null,
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(
      Response.json({
        accountId,
        farmerId,
        items: [{ ...event, sessionId: "synthetic-session-extra" }],
        nextCursor: null,
        hiddenCount: 99,
      }),
    );
  const response = await createBffHandler(
    config,
    fetcher,
  )(req(`farmers/history?id=${farmerId}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    accountId,
    farmerId,
    items: [event],
    nextCursor: null,
  });
  for (const query of [
    `id=${farmerId}&beforeId=${farmerId}`,
    `id=${farmerId}&accountId=${accountId}`,
    `id=${farmerId}&limit=1&limit=2`,
  ]) {
    const network = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: "server-only-jwt" }));
    expect(
      (await createBffHandler(config, network)(req(`farmers/history?${query}`)))
        .status,
    ).toBe(400);
    expect(network).toHaveBeenCalledTimes(1);
  }
});

it("rejects a history response for another farmer before it reaches the browser", async () => {
  const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
    farmerId = "06149451-4004-4a23-a5a2-64a24e485a82";
  const network = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(
      Response.json({
        accountId,
        farmerId: accountId,
        items: [],
        nextCursor: null,
      }),
    );
  const response = await createBffHandler(
    config,
    network,
  )(req(`farmers/history?id=${farmerId}`));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Service unavailable" });
});

it("uses strict land requests with CSRF and sanitizes the server acknowledgment", async () => {
  const landId = "06149451-4004-4a23-a5a2-64a24e485a82";
  const input = {
    mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
    landId,
    geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  };
  const missing = vi.fn();
  expect(
    (
      await createBffHandler(
        config,
        missing,
      )(req("land/register", "POST", input, { "x-csrf-token": "" }))
    ).status,
  ).toBe(403);
  expect(missing).not.toHaveBeenCalled();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(
      Response.json({
        status: "synced",
        landId,
        replayed: false,
        creatorSecret: "synthetic-extra",
      }),
    );
  const response = await createBffHandler(
    config,
    fetcher,
  )(req("land/register", "POST", input));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "synced",
    landId,
    replayed: false,
  });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    ...input,
    label: null,
    point: null,
    reportedAreaHectares: null,
  });
  expect(fetcher.mock.calls[1][1].headers["x-agri-source"]).toBe(
    "field_officer",
  );
});
it("filters land reads without forwarding untrusted scopes or private extra fields", async () => {
  const id = "06149451-4004-4a23-a5a2-64a24e485a82",
    accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
  const land = {
    id,
    geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
    geographyName: "Synthetic village",
    label: null,
    point: { longitude: 80.25, latitude: 8.3, accuracyM: null },
    reportedAreaHectares: 0.125,
    version: 1,
    createdAt: "2026-11-15T00:00:00.000Z",
    identificationOnly: true,
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(
      Response.json({
        accountId,
        items: [{ ...land, ownerId: "synthetic-private-extra" }],
        nextCursor: null,
        hiddenCount: 99,
      }),
    );
  const response = await createBffHandler(config, fetcher)(req("land?limit=1"));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    accountId,
    items: [land],
    nextCursor: null,
  });
  for (const path of [
    `land?organizationId=${accountId}`,
    "land?limit=101",
    `land?limit=1&limit=2`,
    `land/geographies?scope=${accountId}`,
  ]) {
    const calls = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: "server-only-jwt" }));
    expect((await createBffHandler(config, calls)(req(path))).status).toBe(400);
    expect(calls).toHaveBeenCalledTimes(1);
  }
});

it("uses strict geometry requests with CSRF, binds results to the request and strips private extras", async () => {
  const landId = "06149451-4004-4a23-a5a2-64a24e485a82",
    accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
  const ring = [
    [80.2, 8.3],
    [80.201, 8.3],
    [80.201, 8.301],
    [80.2, 8.3],
  ];
  const input = {
    mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
    landId,
    expectedVersion: 0,
    ring,
    source: "gps_walk",
  };
  const untouched = vi.fn();
  for (const bad of [
    { ...input, source: "official_survey" },
    { ...input, verified: true },
    { ...input, ring: ring.slice(0, 3) },
    { ...input, accountId },
  ]) {
    const calls = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: "server-only-jwt" }));
    expect(
      (await createBffHandler(config, calls)(req("land/geometry", "POST", bad)))
        .status,
    ).toBe(400);
    expect(calls).toHaveBeenCalledTimes(1); // token only; never forwarded to the API
  }
  expect(
    (
      await createBffHandler(
        config,
        untouched,
      )(req("land/geometry", "POST", input, { "x-csrf-token": "" }))
    ).status,
  ).toBe(403);
  expect(untouched).not.toHaveBeenCalled();
  const result = {
    status: "synced",
    landId,
    version: 1,
    calculatedAreaM2: 12000.5,
    replayed: false,
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(Response.json({ ...result, createdBy: "private" }));
  const response = await createBffHandler(
    config,
    fetcher,
  )(req("land/geometry", "POST", input));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(result);
  expect(fetcher.mock.calls[1][1].headers["x-agri-source"]).toBe(
    "field_officer",
  );
  // A result for a different land is a server fault, not a success.
  const mismatched = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(Response.json({ ...result, landId: accountId }));
  expect(
    (
      await createBffHandler(
        config,
        mismatched,
      )(req("land/geometry", "POST", input))
    ).status,
  ).toBe(503);
  // Reads: strict query, no forwarded scopes, bound to the requested land.
  for (const query of [
    "",
    `landId=${landId}&organizationId=${accountId}`,
    `landId=${landId}&landId=${landId}`,
    `landId=${landId}&history=0`,
    "landId=not-a-uuid",
  ]) {
    const calls = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: "server-only-jwt" }));
    expect(
      (await createBffHandler(config, calls)(req(`land/geometry?${query}`)))
        .status,
    ).toBe(400);
    expect(calls).toHaveBeenCalledTimes(1);
  }
  const version = {
    id: accountId,
    landId,
    version: 1,
    status: "provisional",
    source: "gps_walk",
    ring,
    accuracyM: null,
    vertexCount: 4,
    calculatedAreaM2: 12000.5,
    createdAt: "2026-11-17T00:00:00.000Z",
    provisionalIdentificationOnly: true,
  };
  const read = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(
      Response.json({
        accountId,
        landId,
        current: { ...version, createdBy: "private" },
        history: [],
        hidden: 1,
      }),
    );
  const ok = await createBffHandler(
    config,
    read,
  )(req(`land/geometry?landId=${landId}&history=true`));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({
    accountId,
    landId,
    current: version,
    history: [],
  });
  expect(String(read.mock.calls[1][0])).toContain(
    `landId=${landId}&history=true`,
  );
  const wrong = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }))
    .mockResolvedValueOnce(
      Response.json({
        accountId,
        landId: accountId,
        current: null,
        history: [],
      }),
    );
  expect(
    (
      await createBffHandler(
        config,
        wrong,
      )(req(`land/geometry?landId=${landId}`))
    ).status,
  ).toBe(503);
});

it("sanitizes account-bound verification receipts and rejects scoped or mismatched lookups", async () => {
  const id = "06149451-4004-4a23-a5a2-64a24e485a82",
    accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
  const receipt = {
    mutationId: id,
    version: 2,
    occurredAt: "2026-11-15T20:00:00.123456Z",
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only" }))
    .mockResolvedValueOnce(
      Response.json({
        accountId,
        farmerId: id,
        receipt: { ...receipt, sessionId: "synthetic-private" },
        hiddenCount: 30,
      }),
    );
  const response = await createBffHandler(
    config,
    fetcher,
  )(req(`farmers/verification-receipt?id=${id}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ accountId, farmerId: id, receipt });
  for (const query of [`id=${id}&actorId=${accountId}`, `id=${id}&id=${id}`]) {
    const call = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: "server-only" }));
    expect(
      (
        await createBffHandler(
          config,
          call,
        )(req(`farmers/verification-receipt?${query}`))
      ).status,
    ).toBe(400);
    expect(call).toHaveBeenCalledTimes(1);
  }
  const mismatch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only" }))
    .mockResolvedValueOnce(
      Response.json({ accountId, farmerId: accountId, receipt }),
    );
  expect(
    (
      await createBffHandler(
        config,
        mismatch,
      )(req(`farmers/verification-receipt?id=${id}`))
    ).status,
  ).toBe(503);
});

it("binds review queue filters to sanitized responses and rejects silently unfiltered pages", async () => {
  const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
  const filters = { status: "pending-review", reviewable: "true" };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only" }))
    .mockResolvedValueOnce(
      Response.json({
        accountId,
        filters,
        items: [],
        nextCursor: null,
        hiddenCount: 100,
      }),
    );
  const response = await createBffHandler(
    config,
    fetcher,
  )(req("farmers?status=pending-review&reviewable=true"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    accountId,
    filters,
    items: [],
    nextCursor: null,
  });
  expect(String(fetcher.mock.calls[1][0])).toContain("reviewable=true");
  const mismatch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only" }))
    .mockResolvedValueOnce(
      Response.json({ accountId, items: [], nextCursor: null }),
    );
  expect(
    (await createBffHandler(config, mismatch)(req("farmers?status=verified")))
      .status,
  ).toBe(503);
  for (const query of [
    "status=verified&reviewable=true",
    "reviewable=false",
    "status=draft&status=verified",
    `status=draft&accountId=${accountId}`,
  ]) {
    const call = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: "server-only" }));
    expect(
      (await createBffHandler(config, call)(req(`farmers?${query}`))).status,
    ).toBe(400);
    expect(call).toHaveBeenCalledTimes(1);
  }
});

const enrollmentIds = {
  mutationId: "c8a85c92-740b-48d5-99d0-1cda6c4cd31c",
  enrollmentId: "06149451-4004-4a23-a5a2-64a24e485a82",
  projectId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  farmerId: "a50456eb-af66-41f0-8c38-0bc827249cd2",
};
const bffSession = () =>
  vi
    .fn()
    .mockResolvedValueOnce(Response.json({ accessToken: "server-only-jwt" }));

it("binds enrollment commands to the request, requires CSRF and strips extra fields", async () => {
  const missing = vi.fn();
  expect(
    (
      await createBffHandler(
        config,
        missing,
      )(
        req("enrollments/enroll", "POST", enrollmentIds, {
          "x-csrf-token": "",
        }),
      )
    ).status,
  ).toBe(403);
  expect(missing).not.toHaveBeenCalled();
  const strict = bffSession();
  expect(
    (
      await createBffHandler(
        config,
        strict,
      )(req("enrollments/enroll", "POST", { ...enrollmentIds, actorId: "x" }))
    ).status,
  ).toBe(400);
  const ok = bffSession().mockResolvedValueOnce(
    Response.json({
      enrollmentId: enrollmentIds.enrollmentId,
      version: 1,
      replayed: false,
      secret: "extra",
    }),
  );
  const response = await createBffHandler(
    config,
    ok,
  )(req("enrollments/enroll", "POST", enrollmentIds));
  expect(await response.json()).toEqual({
    enrollmentId: enrollmentIds.enrollmentId,
    version: 1,
    replayed: false,
  });
  expect(ok.mock.calls[1][1].headers["x-agri-source"]).toBe("field_officer");
  // A mismatched or wrongly versioned acknowledgment fails closed.
  for (const bad of [
    { enrollmentId: enrollmentIds.projectId, version: 1, replayed: false },
    { enrollmentId: enrollmentIds.enrollmentId, version: 2, replayed: false },
  ]) {
    const mismatch = bffSession().mockResolvedValueOnce(Response.json(bad));
    expect(
      (
        await createBffHandler(
          config,
          mismatch,
        )(req("enrollments/enroll", "POST", enrollmentIds))
      ).status,
    ).toBe(503);
  }
  const withdrawn = bffSession().mockResolvedValueOnce(
    Response.json({
      enrollmentId: enrollmentIds.enrollmentId,
      version: 5,
      replayed: false,
    }),
  );
  expect(
    (
      await createBffHandler(
        adminConfig,
        withdrawn,
      )(
        req("enrollments/withdraw", "POST", {
          mutationId: enrollmentIds.mutationId,
          enrollmentId: enrollmentIds.enrollmentId,
          expectedVersion: 1,
        }),
      )
    ).status,
  ).toBe(503);
});

it("validates policy administration requests and read bindings", async () => {
  const input = {
    mutationId: enrollmentIds.mutationId,
    projectId: enrollmentIds.projectId,
    expectedVersion: 0,
    enabled: true,
    eligibleFarmerStatuses: ["verified"],
  };
  for (const bad of [
    { eligibleFarmerStatuses: [] },
    { eligibleFarmerStatuses: ["verified", "verified"] },
    { source: "administrator" },
  ])
    expect(
      (
        await createBffHandler(
          adminConfig,
          bffSession(),
        )(req("enrollment-policies/set", "POST", { ...input, ...bad }))
      ).status,
    ).toBe(400);
  const ok = bffSession().mockResolvedValueOnce(
    Response.json({ projectId: input.projectId, version: 1, replayed: false }),
  );
  expect(
    (
      await createBffHandler(
        adminConfig,
        ok,
      )(req("enrollment-policies/set", "POST", input))
    ).status,
  ).toBe(200);
  const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
  const other = bffSession().mockResolvedValueOnce(
    Response.json({
      accountId,
      projectId: enrollmentIds.farmerId,
      policy: null,
    }),
  );
  expect(
    (
      await createBffHandler(
        adminConfig,
        other,
      )(req(`enrollment-policies?projectId=${input.projectId}`))
    ).status,
  ).toBe(503);
  const good = bffSession().mockResolvedValueOnce(
    Response.json({ accountId, projectId: input.projectId, policy: null }),
  );
  expect(
    await (
      await createBffHandler(
        adminConfig,
        good,
      )(req(`enrollment-policies?projectId=${input.projectId}`))
    ).json(),
  ).toEqual({ accountId, projectId: input.projectId, policy: null });
  // Unknown query keys and duplicates never reach the API.
  const unknown = bffSession();
  expect(
    (
      await createBffHandler(
        adminConfig,
        unknown,
      )(req(`enrollment-policies?projectId=${input.projectId}&role=admin`))
    ).status,
  ).toBe(400);
});

it("rejects enrollment list rows that violate the requested filters or limit", async () => {
  const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
  const row = {
    id: enrollmentIds.enrollmentId,
    organizationId: enrollmentIds.mutationId,
    projectId: enrollmentIds.projectId,
    farmerId: enrollmentIds.farmerId,
    status: "enrolled",
    version: 1,
    enrolledAt: "2026-11-16T00:00:00.000Z",
    withdrawnAt: null,
  };
  const page = (items: unknown[]) =>
    bffSession().mockResolvedValueOnce(
      Response.json({ accountId, items, nextCursor: null }),
    );
  const query = `enrollments?limit=5&projectId=${enrollmentIds.projectId}`;
  expect(
    await (await createBffHandler(config, page([row]))(req(query))).json(),
  ).toMatchObject({ items: [row] });
  expect(
    (
      await createBffHandler(
        config,
        page([{ ...row, projectId: enrollmentIds.farmerId }]),
      )(req(query))
    ).status,
  ).toBe(503);
  expect(
    (
      await createBffHandler(
        config,
        page([row, row]),
      )(req(`enrollments?limit=1`))
    ).status,
  ).toBe(503);
});

it("never forwards browser-supplied identity, source or authorization on enrollment routes", async () => {
  const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
  const fetcher = bffSession().mockResolvedValueOnce(
    Response.json({ accountId, items: [], nextCursor: null }),
  );
  const response = await createBffHandler(
    config,
    fetcher,
  )(
    req("enrollments?limit=5", "GET", undefined, {
      authorization: "Bearer browser-chosen-token",
      "x-agri-source": "administrator",
      "x-agri-bff-key": "browser-chosen-key",
      "x-agri-session": "browser-chosen-session",
      "x-agri-actor": enrollmentIds.farmerId,
    }),
  );
  expect(response.status).toBe(200);
  const [, upstream] = fetcher.mock.calls[1];
  expect(upstream.headers.authorization).toBe("Bearer server-only-jwt");
  expect(upstream.headers["x-agri-source"]).toBe("field_officer");
  expect(upstream.headers["x-agri-bff-key"]).toBe(internal);
  expect(upstream.headers["x-agri-session"]).toBeUndefined();
  expect(upstream.headers["x-agri-actor"]).toBeUndefined();
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain("browser-chosen");
});

it("keeps two officers' concurrent enrollment requests on separate server-issued tokens", async () => {
  const secretA = "A".repeat(43),
    secretB = "D".repeat(43);
  const seen: Array<{ path: string; session?: string; auth?: string }> = [];
  const fetcher = vi.fn(
    async (url: URL, init: { headers: Record<string, string> }) => {
      const path = url.pathname.replace("/pilot/", "");
      seen.push({
        path,
        session: init.headers["x-agri-session"],
        auth: init.headers.authorization,
      });
      // The slower officer's exchange resolves last to expose any shared state.
      if (path === "auth/token") {
        const slow = init.headers["x-agri-session"] === secretA;
        await new Promise((resolve) => setTimeout(resolve, slow ? 20 : 1));
        return Response.json({
          accessToken: slow ? "token-for-officer-a" : "token-for-officer-b",
        });
      }
      return Response.json({
        accountId: enrollmentIds.farmerId,
        items: [],
        nextCursor: null,
      });
    },
  );
  const handler = createBffHandler(config, fetcher as never);
  const asOfficer = (secret: string) =>
    new Request(`${origin}/api/pilot/enrollments?limit=5`, {
      headers: { origin, cookie: `__Host-agri_session=${secret}` },
    });
  // Sequentially, officer B must not inherit anything officer A's request produced.
  expect((await handler(asOfficer(secretA))).status).toBe(200);
  expect((await handler(asOfficer(secretB))).status).toBe(200);
  const sequential = seen.filter((call) => call.path === "enrollments");
  expect(sequential.map((call) => call.auth)).toEqual([
    "Bearer token-for-officer-a",
    "Bearer token-for-officer-b",
  ]);
  seen.length = 0;
  const [a, b] = await Promise.all([
    handler(asOfficer(secretA)),
    handler(asOfficer(secretB)),
  ]);
  expect([a.status, b.status]).toEqual([200, 200]);
  const apiCalls = seen.filter((call) => call.path === "enrollments");
  expect(apiCalls.map((call) => call.auth).sort()).toEqual([
    "Bearer token-for-officer-a",
    "Bearer token-for-officer-b",
  ]);
  // The API call never carries the opaque session secret; only the token exchange does.
  expect(apiCalls.every((call) => call.session === undefined)).toBe(true);
  expect(
    seen
      .filter((call) => call.path === "auth/token")
      .map((call) => call.session)
      .sort(),
  ).toEqual([secretA, secretB].sort());
});

it("does not expose administrator-only enrollment routes through the field-officer BFF", async () => {
  const withdraw = {
    mutationId: enrollmentIds.mutationId,
    enrollmentId: enrollmentIds.enrollmentId,
    expectedVersion: 1,
  };
  const policy = {
    mutationId: enrollmentIds.mutationId,
    projectId: enrollmentIds.projectId,
    expectedVersion: 0,
    enabled: true,
    eligibleFarmerStatuses: ["verified"],
  };
  const hidden: Array<[string, "GET" | "POST", unknown?]> = [
    ["enrollments/withdraw", "POST", withdraw],
    ["enrollment-policies/set", "POST", policy],
    [`enrollment-policies?projectId=${enrollmentIds.projectId}`, "GET"],
  ];
  for (const [path, method, body] of hidden) {
    const fetcher = vi.fn();
    const response = await createBffHandler(
      config,
      fetcher,
    )(req(path, method, body));
    // Refused before any session exchange or upstream call.
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  }
  // The administrator BFF still forwards them and pins the administrator source upstream.
  const fetcher = bffSession().mockResolvedValueOnce(
    Response.json({
      enrollmentId: enrollmentIds.enrollmentId,
      version: 2,
      replayed: false,
    }),
  );
  const response = await createBffHandler(
    adminConfig,
    fetcher,
  )(req("enrollments/withdraw", "POST", withdraw));
  expect(response.status).toBe(200);
  expect(fetcher.mock.calls[1][1].headers["x-agri-source"]).toBe(
    "administrator",
  );
});

it("cannot reach administrator-only routes through path variants on the field-officer BFF", async () => {
  const withdraw = {
    mutationId: enrollmentIds.mutationId,
    enrollmentId: enrollmentIds.enrollmentId,
    expectedVersion: 1,
  };
  // Every variant must be refused (or normalized to a hidden route) before any session exchange or upstream call.
  const variants = [
    "enrollments/withdraw/",
    "Enrollments/Withdraw",
    "ENROLLMENTS/WITHDRAW",
    "enrollments%2Fwithdraw",
    "enrollments%2fwithdraw",
    "enrollments//withdraw",
    "enrollments/./withdraw",
    "enrollments/detail/../withdraw",
    "enrollments/withdraw%00",
    "enrollments/withdraw%20",
    "enrollments/withdraw;x=1",
    "enrollment-policies/set/",
    "enrollment-policies%2Fset",
    "enrollment-policies/./set",
  ];
  for (const path of variants) {
    const fetcher = vi.fn();
    const response = await createBffHandler(
      config,
      fetcher,
    )(req(path, "POST", withdraw));
    expect(response.status, path).toBe(404);
    expect(fetcher, path).not.toHaveBeenCalled();
  }
  // Method confusion: the same hidden route must not answer a different method either.
  for (const method of ["GET", "PUT", "PATCH", "DELETE"] as const) {
    const fetcher = vi.fn();
    const response = await createBffHandler(
      config,
      fetcher,
    )(req("enrollments/withdraw", method));
    expect(response.status, method).toBe(404);
    expect(fetcher, method).not.toHaveBeenCalled();
  }
});
describe("farmer and land routes never forward browser-chosen identity", () => {
  const farmerId = enrollmentIds.farmerId,
    landId = enrollmentIds.projectId;
  const routes: Array<[string, "GET" | "POST", unknown?]> = [
    ["farmers?limit=5", "GET"],
    [`farmers/detail?id=${farmerId}`, "GET"],
    [`farmers/history?id=${farmerId}`, "GET"],
    ["land?limit=5", "GET"],
    [`land/detail?id=${landId}`, "GET"],
    [
      "farmers/change",
      "POST",
      {
        mutationId: enrollmentIds.mutationId,
        farmerId,
        expectedVersion: 1,
        action: "verification",
        reason: "Synthetic isolation check",
      },
    ],
    [
      "land/register",
      "POST",
      {
        mutationId: enrollmentIds.mutationId,
        landId,
        geographyId: enrollmentIds.enrollmentId,
      },
    ],
    [
      "land/geometry",
      "POST",
      {
        mutationId: enrollmentIds.mutationId,
        landId,
        expectedVersion: 0,
        ring: [
          [80.2, 8.3],
          [80.201, 8.3],
          [80.201, 8.301],
          [80.2, 8.3],
        ],
        source: "gps_walk",
      },
    ],
  ];
  const spoof = {
    authorization: "Bearer browser-chosen-token",
    "x-agri-source": "administrator",
    "x-agri-bff-key": "browser-chosen-key",
    "x-agri-session": "browser-chosen-session",
    "x-agri-actor": enrollmentIds.farmerId,
    "x-agri-account": enrollmentIds.projectId,
  };
  it.each(routes)(
    "sends only server-owned headers upstream for %s",
    async (path, method, body) => {
      const fetcher = bffSession().mockResolvedValueOnce(Response.json({}));
      await createBffHandler(config, fetcher)(req(path, method, body, spoof));
      expect(fetcher).toHaveBeenCalledTimes(2);
      const headers = fetcher.mock.calls[1][1].headers as Record<
        string,
        string
      >;
      const expected = [
        "authorization",
        "x-agri-bff-key",
        "x-agri-origin",
        "x-agri-source",
        ...(method === "POST" ? ["Content-Type", "x-csrf-token"] : []),
      ];
      // The exact header set proves nothing extra, such as a browser actor, was forwarded.
      expect(Object.keys(headers).sort()).toEqual(expected.sort());
      expect(headers.authorization).toBe("Bearer server-only-jwt");
      expect(headers["x-agri-source"]).toBe("field_officer");
      expect(headers["x-agri-bff-key"]).toBe(internal);
      expect(JSON.stringify(fetcher.mock.calls)).not.toContain(
        "browser-chosen",
      );
    },
  );
  it.each(routes.filter(([, method]) => method === "GET"))(
    "rejects an unknown identity query parameter on %s before any upstream data call",
    async (path) => {
      const fetcher = bffSession();
      const response = await createBffHandler(
        config,
        fetcher,
      )(req(`${path}&accountId=${enrollmentIds.projectId}`));
      expect(response.status).toBe(400);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
