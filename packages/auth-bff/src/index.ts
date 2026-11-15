import {
  farmerListQuerySchema,
  farmerDetailQuerySchema,
  farmerPageSchema,
  farmerDetailSchema,
} from "@agri/validation";
/** Server route code only. Never import configured instances into client components. */
export type BffConfig = {
  apiOrigin: string;
  publicOrigin: string;
  internalKey: string;
  source: "field_officer" | "administrator";
  allowInsecureLocal?: boolean;
};
const clearCookie =
  "__Host-agri_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class Failure extends Error {
  constructor(readonly status: number) {
    super("Request failed");
  }
}
const reply = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...headers,
    },
  });
function opaqueCookie(request: Request): string {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("__Host-agri_session="));
  if (values.length !== 1) throw new Failure(401);
  const secret = values[0].slice("__Host-agri_session=".length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Failure(401);
  return secret;
}
async function body(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new Failure(400);
  if (!request.body) throw new Failure(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 16384) {
        await reader.cancel();
        throw new Failure(413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged));
  } catch {
    throw new Failure(400);
  }
}
export function createBffHandler(
  config: BffConfig,
  fetcher: typeof fetch = fetch,
): (request: Request) => Promise<Response> {
  const api = new URL(config.apiOrigin);
  const frontend = new URL(config.publicOrigin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname);
  if (
    (api.protocol !== "https:" &&
      !(config.allowInsecureLocal && local && api.protocol === "http:")) ||
    api.username ||
    api.password ||
    api.pathname !== "/" ||
    api.search ||
    api.hash ||
    frontend.protocol !== "https:" ||
    frontend.origin !== config.publicOrigin ||
    config.internalKey.length < 43
  )
    throw new Error("Invalid BFF configuration");
  async function call(
    path: string,
    method: string,
    secret?: string,
    accessToken?: string,
    input?: unknown,
    csrf?: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "x-agri-bff-key": config.internalKey,
      "x-agri-source": config.source,
      "x-agri-origin": config.publicOrigin,
    };
    if (secret) headers["x-agri-session"] = secret;
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (csrf) headers["x-csrf-token"] = csrf;
    if (input !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await fetcher(new URL(`/pilot/${path}`, api), {
        method,
        headers,
        body: input !== undefined ? JSON.stringify(input) : undefined,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new Failure(503);
    }
    if (!response.ok)
      throw new Failure(
        [400, 401, 403, 404, 409, 429].includes(response.status)
          ? response.status
          : 503,
      );
    try {
      return await response.json();
    } catch {
      throw new Failure(503);
    }
  }
  return async (request) => {
    try {
      const path = new URL(request.url).pathname.replace(/^\/api\/pilot\//, "");
      const allowed =
        (request.method === "POST" &&
          [
            "auth/login",
            "auth/device-challenge",
            "auth/logout",
            "farmers/register",
          ].includes(path)) ||
        (request.method === "GET" &&
          [
            "auth/csrf",
            "farmers",
            "farmers/detail",
            "registration/geographies",
            "registration/context",
          ].includes(path));
      if (!allowed) return reply({ error: "Not found" }, 404);
      const origin = request.headers.get("origin");
      if (
        (request.method !== "GET" && origin !== config.publicOrigin) ||
        (origin !== null && origin !== config.publicOrigin) ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new Failure(403);
      if (path === "auth/device-challenge") {
        const result = (await call(
          path,
          "POST",
          undefined,
          undefined,
          await body(request),
        )) as { nonce?: unknown; expiresAt?: unknown; mac?: unknown };
        if (
          typeof result?.nonce !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(result.nonce) ||
          typeof result.mac !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(result.mac) ||
          typeof result.expiresAt !== "number" ||
          !Number.isSafeInteger(result.expiresAt)
        )
          throw new Failure(503);
        return reply({
          nonce: result.nonce,
          expiresAt: result.expiresAt,
          mac: result.mac,
        });
      }
      if (path === "auth/login") {
        const result = (await call(
          "auth/login",
          "POST",
          undefined,
          undefined,
          await body(request),
        )) as { cookie?: unknown };
        if (
          typeof result.cookie !== "string" ||
          !/^__Host-agri_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=\d+$/.test(
            result.cookie,
          )
        )
          throw new Failure(503);
        return reply({ signedIn: true }, 200, { "Set-Cookie": result.cookie });
      }
      const secret = opaqueCookie(request);
      if (path === "auth/csrf") {
        const result = (await call("auth/csrf", "POST", secret)) as {
          csrfToken?: unknown;
          accountId?: unknown;
          deviceId?: unknown;
        };
        if (
          typeof result.deviceId !== "string" ||
          !uuid.test(result.deviceId) ||
          typeof result.accountId !== "string" ||
          !uuid.test(result.accountId) ||
          typeof result.csrfToken !== "string" ||
          !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(result.csrfToken)
        )
          throw new Failure(503);
        return reply({
          csrfToken: result.csrfToken,
          accountId: result.accountId,
          deviceId: result.deviceId,
        });
      }
      const csrf = request.headers.get("x-csrf-token") ?? "";
      if (
        request.method === "POST" &&
        !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(csrf)
      )
        throw new Failure(403);
      if (path === "auth/logout") {
        try {
          await call("auth/logout", "POST", secret, undefined, undefined, csrf);
        } catch (error) {
          if (!(error instanceof Failure) || error.status !== 401) throw error;
        }
        return reply({ loggedOut: true }, 200, { "Set-Cookie": clearCookie });
      }
      const signed = (await call("auth/token", "POST", secret)) as {
        accessToken?: unknown;
      };
      if (
        typeof signed.accessToken !== "string" ||
        signed.accessToken.length > 16384
      )
        throw new Failure(503);
      if (path === "farmers" || path === "farmers/detail") {
        const params = new URL(request.url).searchParams;
        const keys = Array.from(params.keys());
        if (new Set(keys).size !== keys.length) throw new Failure(400);
        const schema =
          path === "farmers" ? farmerListQuerySchema : farmerDetailQuerySchema;
        const query = schema.safeParse(Object.fromEntries(params));
        if (!query.success) throw new Failure(400);
        const safeParams = new URLSearchParams(
          Object.entries(query.data).map(([key, value]) => [
            key,
            String(value),
          ]),
        );
        const result = await call(
          `${path}?${safeParams}`,
          "GET",
          undefined,
          signed.accessToken,
        );
        const parsed = (
          path === "farmers" ? farmerPageSchema : farmerDetailSchema
        ).safeParse(result);
        if (!parsed.success) throw new Failure(503);
        return reply(parsed.data);
      }
      if (path === "registration/context") {
        const result = (await call(
          path,
          "GET",
          undefined,
          signed.accessToken,
        )) as {
          accountId?: unknown;
          deviceId?: unknown;
          deviceKeyFingerprint?: unknown;
          verifiedAt?: unknown;
          offlineUntil?: unknown;
          geographies?: unknown;
        };
        if (
          typeof result?.accountId !== "string" ||
          !uuid.test(result.accountId) ||
          typeof result.deviceId !== "string" ||
          !uuid.test(result.deviceId) ||
          typeof result.deviceKeyFingerprint !== "string" ||
          !/^[0-9a-f]{64}$/.test(result.deviceKeyFingerprint) ||
          typeof result.verifiedAt !== "number" ||
          !Number.isSafeInteger(result.verifiedAt) ||
          typeof result.offlineUntil !== "number" ||
          !Number.isSafeInteger(result.offlineUntil) ||
          result.offlineUntil <= result.verifiedAt ||
          result.offlineUntil - result.verifiedAt > 86400000 ||
          !Array.isArray(result.geographies) ||
          result.geographies.length > 10000 ||
          result.geographies.some(
            (value) =>
              typeof value?.id !== "string" ||
              !uuid.test(value.id) ||
              typeof value?.name !== "string" ||
              value.name.length > 1000,
          )
        )
          throw new Failure(503);
        return reply({
          accountId: result.accountId,
          deviceId: result.deviceId,
          deviceKeyFingerprint: result.deviceKeyFingerprint,
          verifiedAt: result.verifiedAt,
          offlineUntil: result.offlineUntil,
          geographies: result.geographies.map((value) => ({
            id: value.id,
            name: value.name,
          })),
        });
      }
      if (path === "registration/geographies") {
        const result = await call(path, "GET", undefined, signed.accessToken);
        if (
          !Array.isArray(result) ||
          result.length > 10000 ||
          result.some(
            (value) =>
              typeof value?.id !== "string" ||
              !uuid.test(value.id) ||
              typeof value?.name !== "string",
          )
        )
          throw new Failure(503);
        return reply(
          result.map((value) => ({ id: value.id, name: value.name })),
        );
      }
      const result = (await call(
        path,
        "POST",
        undefined,
        signed.accessToken,
        await body(request),
        csrf,
      )) as { status?: unknown; farmerId?: unknown; replayed?: unknown };
      if (
        result.status !== "synced" ||
        typeof result.farmerId !== "string" ||
        !uuid.test(result.farmerId) ||
        typeof result.replayed !== "boolean"
      )
        throw new Failure(503);
      return reply({
        status: "synced",
        farmerId: result.farmerId,
        replayed: result.replayed,
      });
    } catch (error) {
      const status = error instanceof Failure ? error.status : 503;
      return reply(
        {
          error:
            status === 401
              ? "Authentication required"
              : status === 403
                ? "Action denied"
                : status === 404
                  ? "Not found"
                  : status === 409
                    ? "Conflict"
                    : status === 400 || status === 413
                      ? "Invalid request"
                      : "Service unavailable",
        },
        status,
      );
    }
  };
}
