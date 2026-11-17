import { FixedWindowLimiter } from "./rate-limit";
import {
  projectChangeSchema,
  projectChangeResultSchema,
  projectRegistrationSchema,
  projectRegistrationResultSchema,
  projectQuerySchema,
  projectDetailQuerySchema,
  projectDetailSchema,
  projectPageSchema,
  projectOrganizationsSchema,
} from "@agri/validation";
import {
  enrollmentCreateSchema,
  enrollmentWithdrawSchema,
  enrollmentResultSchema,
  enrollmentQuerySchema,
  enrollmentDetailQuerySchema,
  enrollmentPageSchema,
  enrollmentDetailSchema,
  enrollmentPolicySetSchema,
  enrollmentPolicyQuerySchema,
  enrollmentPolicyResultSchema,
  enrollmentPolicyDetailSchema,
} from "@agri/validation";
import {
  landRegistrationSchema,
  landRegistrationResultSchema,
  landQuerySchema,
  landDetailQuerySchema,
  landDetailSchema,
  landPageSchema,
  landGeographiesSchema,
  landGeometryRecordSchema,
  landGeometryResultSchema,
  landGeometryQuerySchema,
  landGeometryReadSchema,
  landViewportQuerySchema,
  landViewportSchema,
} from "@agri/validation";
import {
  farmerHistoryQuerySchema,
  farmerHistoryPageSchema,
} from "@agri/validation";
import {
  farmerCorrectionGeographiesQuerySchema,
  farmerCorrectionGeographiesSchema,
  farmerChangeSchema,
  farmerChangeResultSchema,
  farmerListQuerySchema,
  farmerDetailQuerySchema,
  farmerPageSchema,
  sameFarmerFilters,
  farmerDetailSchema,
  farmerVerificationReceiptSchema,
  farmerCorrectionReceiptSchema,
} from "@agri/validation";
/** Server route code only. Never import configured instances into client components. */
export type BffConfig = {
  apiOrigin: string;
  publicOrigin: string;
  internalKey: string;
  source: "field_officer" | "administrator";
  allowInsecureLocal?: boolean;
  /**
   * Number of trusted reverse proxies in front of this BFF that each append the address they received the
   * request from to `X-Forwarded-For`. 0 (the default) means no forwarding header is trusted, so every login is
   * attributed to one shared "unattributed" client and only the (much larger) broad client limit applies.
   */
  trustedProxyHops?: number;
  /** Per-minute request budgets for one BFF instance. Provisional values; the edge should add its own limit. */
  rateLimits?: {
    /** Unauthenticated routes (login, device challenge) per attributed client address. */
    anonymousPerClient?: number;
    /** The same routes when no client address could be attributed (one shared budget). */
    anonymousUnattributed?: number;
    /** Authenticated read requests per session. */
    sessionReads?: number;
    /** Authenticated write requests per session. */
    sessionWrites?: number;
  };
  /** Clock for tests. */
  now?: () => number;
};
/**
 * The client address as seen by the outermost trusted proxy: the `hops`-th entry from the right of
 * `X-Forwarded-For`. Entries further left are supplied by the caller and are never used. Anything that does not
 * look like an address, or a chain shorter than the configured depth, yields no attribution.
 */
export function trustedClientAddress(
  request: Request,
  hops: number,
): string | undefined {
  if (hops < 1) return undefined;
  const header = request.headers.get("x-forwarded-for");
  if (!header || header.length > 1000) return undefined;
  const parts = header.split(",").map((part) => part.trim());
  if (parts.length < hops) return undefined;
  const candidate = parts[parts.length - hops];
  return /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : undefined;
}
const clearCookie =
  "__Host-agri_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class Failure extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super("Request failed");
  }
}
const defaultBodyLimit = 16384;
// A survey polygon may have up to 5000 vertices (about 30 bytes each as JSON), far more than other requests.
const geometryBodyLimit = 163840;
const maxUrlLength = 2048;
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
// The body is read at most once per request, as early as possible, so malformed or oversize input is refused
// before the BFF makes any call to the API.
const parsedBodies = new WeakMap<Request, unknown>();
async function body(
  request: Request,
  limit = defaultBodyLimit,
): Promise<unknown> {
  if (parsedBodies.has(request)) return parsedBodies.get(request);
  const value = await readBody(request, limit);
  parsedBodies.set(request, value);
  return value;
}
async function readBody(request: Request, limit: number): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new Failure(400);
  // Refuse a declared oversize body before reading any of it.
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d{1,12}$/.test(declared) || Number(declared) > limit)
  )
    throw new Failure(413);
  if (!request.body) throw new Failure(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > limit) {
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
    config.internalKey.length < 43 ||
    !Number.isInteger(config.trustedProxyHops ?? 0) ||
    (config.trustedProxyHops ?? 0) < 0 ||
    (config.trustedProxyHops ?? 0) > 5
  )
    throw new Error("Invalid BFF configuration");
  const hops = config.trustedProxyHops ?? 0;
  const clock = config.now ?? (() => Date.now());
  const budgets = {
    anonymousPerClient: config.rateLimits?.anonymousPerClient ?? 30,
    anonymousUnattributed: config.rateLimits?.anonymousUnattributed ?? 300,
    sessionReads: config.rateLimits?.sessionReads ?? 240,
    sessionWrites: config.rateLimits?.sessionWrites ?? 60,
  };
  for (const value of Object.values(budgets))
    if (!Number.isInteger(value) || value < 1 || value > 100000)
      throw new Error("Invalid BFF configuration");
  const limiter = new FixedWindowLimiter(60_000, 10_000);
  async function rateKey(request: Request, anonymousRoute: boolean) {
    const write = request.method !== "GET";
    if (!anonymousRoute) {
      try {
        // Hash the opaque cookie so a raw session secret is never kept as a map key.
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(opaqueCookie(request)),
        );
        const hex = Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        return {
          key: `s:${write ? "w" : "r"}:${hex}`,
          limit: write ? budgets.sessionWrites : budgets.sessionReads,
        };
      } catch {
        // A missing or malformed cookie falls through to the anonymous budget; it never gets a session budget.
      }
    }
    const client = trustedClientAddress(request, hops);
    return client
      ? { key: `a:${client}`, limit: budgets.anonymousPerClient }
      : { key: "a:unattributed", limit: budgets.anonymousUnattributed };
  }
  async function call(
    path: string,
    method: string,
    secret?: string,
    accessToken?: string,
    input?: unknown,
    csrf?: string,
    client?: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "x-agri-bff-key": config.internalKey,
      "x-agri-source": config.source,
      "x-agri-origin": config.publicOrigin,
    };
    if (secret) headers["x-agri-session"] = secret;
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (csrf) headers["x-csrf-token"] = csrf;
    // Only ever set here from the trusted-proxy rule; a browser-supplied copy of this header is never forwarded.
    if (client) headers["x-agri-client"] = client;
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
      if (request.url.length > maxUrlLength) throw new Failure(414);
      const path = new URL(request.url).pathname.replace(/^\/api\/pilot\//, "");
      const allowed =
        (request.method === "POST" &&
          [
            "auth/login",
            "auth/device-challenge",
            "auth/logout",
            "farmers/register",
            "farmers/change",
            "land/register",
            "land/geometry",
            "projects/register",
            "projects/change",
            "enrollments/enroll",
            "enrollments/withdraw",
            "enrollment-policies/set",
          ].includes(path)) ||
        (request.method === "GET" &&
          [
            "auth/csrf",
            "farmers",
            "farmers/detail",
            "farmers/history",
            "farmers/verification-receipt",
            "farmers/correction-receipt",
            "farmers/correction-geographies",
            "land",
            "land/detail",
            "land/geometry",
            "land/viewport",
            "land/geographies",
            "projects",
            "projects/detail",
            "projects/organizations",
            "enrollments",
            "enrollments/detail",
            "enrollment-policies",
            "registration/geographies",
            "registration/context",
          ].includes(path));
      // Administrator-only routes are not exposed by the field-officer BFF at all (PostgreSQL enforces the same rule).
      const administratorOnly = [
        "enrollments/withdraw",
        "enrollment-policies",
        "enrollment-policies/set",
      ].includes(path);
      if (!allowed || (administratorOnly && config.source !== "administrator"))
        return reply({ error: "Not found" }, 404);
      const origin = request.headers.get("origin");
      if (
        (request.method !== "GET" && origin !== config.publicOrigin) ||
        (origin !== null && origin !== config.publicOrigin) ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new Failure(403);
      const anonymousRoute =
        path === "auth/login" || path === "auth/device-challenge";
      const budget = await rateKey(request, anonymousRoute);
      const decision = limiter.consume(budget.key, budget.limit, clock());
      if (!decision.allowed) throw new Failure(429, decision.retryAfterSeconds);
      // Read and cap the body now (logout carries none): a bot cannot make the BFF call the API for bad input.
      if (request.method === "POST" && path !== "auth/logout")
        await body(
          request,
          path === "land/geometry" ? geometryBodyLimit : defaultBodyLimit,
        );
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
          undefined,
          trustedClientAddress(request, hops),
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
      if (path === "projects/change") {
        const parsed = projectChangeSchema.safeParse(await body(request));
        if (!parsed.success) throw new Failure(400);
        const result = projectChangeResultSchema.safeParse(
          await call(
            path,
            "POST",
            undefined,
            signed.accessToken,
            parsed.data,
            csrf,
          ),
        );
        if (
          !result.success ||
          result.data.projectId !== parsed.data.projectId ||
          result.data.version !== parsed.data.expectedVersion + 1
        )
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "projects/register") {
        const parsed = projectRegistrationSchema.safeParse(await body(request));
        if (!parsed.success) throw new Failure(400);
        const result = projectRegistrationResultSchema.safeParse(
          await call(
            path,
            "POST",
            undefined,
            signed.accessToken,
            parsed.data,
            csrf,
          ),
        );
        if (!result.success || result.data.projectId !== parsed.data.projectId)
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "projects/organizations") {
        if (new URL(request.url).search) throw new Failure(400);
        const result = projectOrganizationsSchema.safeParse(
          await call(path, "GET", undefined, signed.accessToken),
        );
        if (!result.success) throw new Failure(503);
        return reply(result.data);
      }
      if (path === "projects" || path === "projects/detail") {
        const params = new URL(request.url).searchParams;
        if (new Set(params.keys()).size !== Array.from(params.keys()).length)
          throw new Failure(400);
        const query = (
          path === "projects" ? projectQuerySchema : projectDetailQuerySchema
        ).safeParse(Object.fromEntries(params));
        if (!query.success) throw new Failure(400);
        const safeParams = new URLSearchParams(
          Object.entries(query.data).map(([key, value]) => [
            key,
            String(value),
          ]),
        );
        const result = (
          path === "projects" ? projectPageSchema : projectDetailSchema
        ).safeParse(
          await call(
            `${path}?${safeParams}`,
            "GET",
            undefined,
            signed.accessToken,
          ),
        );
        if (
          !result.success ||
          (path === "projects" &&
            "items" in result.data &&
            result.data.items.length >
              ("limit" in query.data ? query.data.limit : 0))
        )
          throw new Failure(503);
        if (
          path === "projects/detail" &&
          (!("project" in result.data) ||
            !("id" in query.data) ||
            result.data.project.id !== query.data.id)
        )
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "enrollments/enroll") {
        const parsed = enrollmentCreateSchema.safeParse(await body(request));
        if (!parsed.success) throw new Failure(400);
        const result = enrollmentResultSchema.safeParse(
          await call(
            path,
            "POST",
            undefined,
            signed.accessToken,
            parsed.data,
            csrf,
          ),
        );
        if (
          !result.success ||
          result.data.enrollmentId !== parsed.data.enrollmentId ||
          result.data.version !== 1
        )
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "enrollments/withdraw") {
        const parsed = enrollmentWithdrawSchema.safeParse(await body(request));
        if (!parsed.success) throw new Failure(400);
        const result = enrollmentResultSchema.safeParse(
          await call(
            path,
            "POST",
            undefined,
            signed.accessToken,
            parsed.data,
            csrf,
          ),
        );
        if (
          !result.success ||
          result.data.enrollmentId !== parsed.data.enrollmentId ||
          result.data.version !== parsed.data.expectedVersion + 1
        )
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "enrollment-policies/set") {
        const parsed = enrollmentPolicySetSchema.safeParse(await body(request));
        if (!parsed.success) throw new Failure(400);
        const result = enrollmentPolicyResultSchema.safeParse(
          await call(
            path,
            "POST",
            undefined,
            signed.accessToken,
            parsed.data,
            csrf,
          ),
        );
        if (
          !result.success ||
          result.data.projectId !== parsed.data.projectId ||
          result.data.version !== parsed.data.expectedVersion + 1
        )
          throw new Failure(503);
        return reply(result.data);
      }
      if (
        path === "enrollments" ||
        path === "enrollments/detail" ||
        path === "enrollment-policies"
      ) {
        const params = new URL(request.url).searchParams;
        if (new Set(params.keys()).size !== Array.from(params.keys()).length)
          throw new Failure(400);
        const schemas = {
          enrollments: [enrollmentQuerySchema, enrollmentPageSchema],
          "enrollments/detail": [
            enrollmentDetailQuerySchema,
            enrollmentDetailSchema,
          ],
          "enrollment-policies": [
            enrollmentPolicyQuerySchema,
            enrollmentPolicyDetailSchema,
          ],
        } as const;
        const [querySchema, resultSchema] = schemas[path];
        const query = querySchema.safeParse(Object.fromEntries(params));
        if (!query.success) throw new Failure(400);
        const filters = query.data as Record<string, unknown>;
        const safeParams = new URLSearchParams(
          Object.entries(filters).map(([key, value]) => [key, String(value)]),
        );
        const result = resultSchema.safeParse(
          await call(
            `${path}?${safeParams}`,
            "GET",
            undefined,
            signed.accessToken,
          ),
        );
        if (!result.success) throw new Failure(503);
        const data = result.data as Record<string, unknown>;
        if (path === "enrollments") {
          const items = data.items as Array<Record<string, unknown>>;
          if (
            items.length > (filters.limit as number) ||
            items.some(
              (row) =>
                (filters.projectId !== undefined &&
                  row.projectId !== filters.projectId) ||
                (filters.farmerId !== undefined &&
                  row.farmerId !== filters.farmerId) ||
                (filters.status !== undefined && row.status !== filters.status),
            )
          )
            throw new Failure(503);
        }
        if (
          path === "enrollments/detail" &&
          (data.enrollment as { id?: unknown }).id !== filters.id
        )
          throw new Failure(503);
        if (path === "enrollment-policies") {
          const policy = data.policy as { projectId?: unknown } | null;
          if (
            data.projectId !== filters.projectId ||
            (policy !== null && policy.projectId !== filters.projectId)
          )
            throw new Failure(503);
        }
        return reply(result.data);
      }
      if (path === "land/register") {
        const parsed = landRegistrationSchema.safeParse(await body(request));
        if (!parsed.success) throw new Failure(400);
        const result = landRegistrationResultSchema.safeParse(
          await call(
            path,
            "POST",
            undefined,
            signed.accessToken,
            parsed.data,
            csrf,
          ),
        );
        if (!result.success || result.data.landId !== parsed.data.landId)
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "land/geometry" && request.method === "POST") {
        const parsed = landGeometryRecordSchema.safeParse(
          await body(request, geometryBodyLimit),
        );
        if (!parsed.success) throw new Failure(400);
        const result = landGeometryResultSchema.safeParse(
          await call(
            path,
            "POST",
            undefined,
            signed.accessToken,
            parsed.data,
            csrf,
          ),
        );
        if (!result.success || result.data.landId !== parsed.data.landId)
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "land/geometry") {
        const params = new URL(request.url).searchParams;
        if (new Set(params.keys()).size !== Array.from(params.keys()).length)
          throw new Failure(400);
        const query = landGeometryQuerySchema.safeParse(
          Object.fromEntries(params),
        );
        if (!query.success) throw new Failure(400);
        const result = landGeometryReadSchema.safeParse(
          await call(
            `${path}?${new URLSearchParams({
              landId: query.data.landId,
              history: String(query.data.history),
            })}`,
            "GET",
            undefined,
            signed.accessToken,
          ),
        );
        if (!result.success || result.data.landId !== query.data.landId)
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "land/viewport") {
        const params = new URL(request.url).searchParams;
        if (new Set(params.keys()).size !== Array.from(params.keys()).length)
          throw new Failure(400);
        const query = landViewportQuerySchema.safeParse(
          Object.fromEntries(params),
        );
        if (!query.success) throw new Failure(400);
        const result = landViewportSchema.safeParse(
          await call(
            `${path}?${new URLSearchParams(
              Object.entries(query.data).map(([key, value]) => [
                key,
                String(value),
              ]),
            )}`,
            "GET",
            undefined,
            signed.accessToken,
          ),
        );
        const { west, south, east, north } = query.data;
        if (
          !result.success ||
          result.data.bbox.west !== west ||
          result.data.bbox.south !== south ||
          result.data.bbox.east !== east ||
          result.data.bbox.north !== north ||
          result.data.polygons.length > query.data.limit ||
          result.data.points.length > query.data.limit
        )
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "land/geographies") {
        if (new URL(request.url).search) throw new Failure(400);
        const result = landGeographiesSchema.safeParse(
          await call(path, "GET", undefined, signed.accessToken),
        );
        if (!result.success) throw new Failure(503);
        return reply(result.data);
      }
      if (path === "land" || path === "land/detail") {
        const params = new URL(request.url).searchParams;
        if (new Set(params.keys()).size !== Array.from(params.keys()).length)
          throw new Failure(400);
        const query = (
          path === "land" ? landQuerySchema : landDetailQuerySchema
        ).safeParse(Object.fromEntries(params));
        if (!query.success) throw new Failure(400);
        const safeParams = new URLSearchParams(
          Object.entries(query.data).map(([key, value]) => [
            key,
            String(value),
          ]),
        );
        const result = (
          path === "land" ? landPageSchema : landDetailSchema
        ).safeParse(
          await call(
            `${path}?${safeParams}`,
            "GET",
            undefined,
            signed.accessToken,
          ),
        );
        if (!result.success) throw new Failure(503);
        if (
          path === "land/detail" &&
          (!("land" in result.data) ||
            !("id" in query.data) ||
            result.data.land.id !== query.data.id)
        )
          throw new Failure(503);
        return reply(result.data);
      }
      if (path === "farmers/correction-geographies") {
        const params = new URL(request.url).searchParams;
        const keys = Array.from(params.keys());
        if (keys.length !== new Set(keys).size) throw new Failure(400);
        const query = farmerCorrectionGeographiesQuerySchema.safeParse(
          Object.fromEntries(params),
        );
        if (!query.success) throw new Failure(400);
        const safeParams = new URLSearchParams(
          Object.entries(query.data).map(([key, value]) => [
            key,
            String(value),
          ]),
        );
        const page = farmerCorrectionGeographiesSchema.safeParse(
          await call(
            `${path}?${safeParams}`,
            "GET",
            undefined,
            signed.accessToken,
          ),
        );
        if (
          !page.success ||
          page.data.farmerId.toLowerCase() !== query.data.id.toLowerCase() ||
          page.data.geographies.length > query.data.limit
        )
          throw new Failure(503);
        return reply(page.data);
      }
      if (path === "farmers/change") {
        const parsed = farmerChangeSchema.safeParse(await body(request));
        if (!parsed.success) throw new Failure(400);
        const result = farmerChangeResultSchema.safeParse(
          await call(
            path,
            "POST",
            undefined,
            signed.accessToken,
            parsed.data,
            csrf,
          ),
        );
        if (!result.success) throw new Failure(503);
        return reply(result.data);
      }
      if (
        [
          "farmers",
          "farmers/detail",
          "farmers/history",
          "farmers/verification-receipt",
          "farmers/correction-receipt",
        ].includes(path)
      ) {
        const params = new URL(request.url).searchParams;
        const keys = Array.from(params.keys());
        if (new Set(keys).size !== keys.length) throw new Failure(400);
        const schema =
          path === "farmers"
            ? farmerListQuerySchema
            : path === "farmers/history"
              ? farmerHistoryQuerySchema
              : farmerDetailQuerySchema;
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
          path === "farmers"
            ? farmerPageSchema
            : path === "farmers/history"
              ? farmerHistoryPageSchema
              : [
                    "farmers/verification-receipt",
                    "farmers/correction-receipt",
                  ].includes(path)
                ? path === "farmers/correction-receipt"
                  ? farmerCorrectionReceiptSchema
                  : farmerVerificationReceiptSchema
                : farmerDetailSchema
        ).safeParse(result);
        if (!parsed.success) throw new Failure(503);
        if (path === "farmers") {
          const expected = farmerListQuerySchema.parse(query.data);
          const page = farmerPageSchema.parse(parsed.data);
          if (!sameFarmerFilters(expected, page.filters))
            throw new Failure(503);
        }
        if (
          [
            "farmers/history",
            "farmers/verification-receipt",
            "farmers/correction-receipt",
          ].includes(path) &&
          (!("farmerId" in parsed.data) ||
            !("id" in query.data) ||
            parsed.data.farmerId !== query.data.id)
        )
          throw new Failure(503);
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
                    : status === 400 || status === 413 || status === 414
                      ? "Invalid request"
                      : status === 429
                        ? "Too many requests"
                        : "Service unavailable",
        },
        status,
        error instanceof Failure && error.retryAfterSeconds
          ? { "Retry-After": String(error.retryAfterSeconds) }
          : {},
      );
    }
  };
}
