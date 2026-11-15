import {
  landRegistrationSchema,
  landRegistrationResultSchema,
  landPageSchema,
  landDetailSchema,
  landGeographiesSchema,
  type LandRegistration,
} from "@agri/validation";
import {
  farmerHistoryQuerySchema,
  farmerHistoryPageSchema,
  type FarmerHistoryCursor,
} from "@agri/validation";
import {
  farmerChangeSchema,
  farmerChangeResultSchema,
  type FarmerChange,
  farmerPageSchema,
  farmerDetailSchema,
} from "@agri/validation";
import { DeviceKeys, deviceKeyFingerprint } from "./device-keys";
import { VaultCatalog } from "./vault-catalog";
import {
  offlineReferenceContextSchema,
  type FarmerRegistration,
} from "@agri/validation";
import type { SyncResult } from "./registration-outbox";

export class PilotRequestError extends Error {
  constructor(readonly status: number) {
    super("Pilot request failed");
  }
}
export type RegistrationRequest = {
  mutationId: string;
  farmer: FarmerRegistration;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Browser transport: cookies are HttpOnly; JWTs are never returned by the BFF. */
export class PilotClient {
  private devices?: DeviceKeys;
  private readonly deviceFactory: () => DeviceKeys;
  private readonly origin: () => string;
  constructor(
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
    options: { devices?: () => DeviceKeys; origin?: () => string } = {},
  ) {
    this.deviceFactory = options.devices ?? (() => new DeviceKeys());
    this.origin = options.origin ?? (() => window.location.origin);
  }
  private keys() {
    return (this.devices ??= this.deviceFactory());
  }
  async prepareDevice(deviceId: string) {
    const publicKey = await this.keys().prepare(deviceId);
    return {
      version: 1,
      origin: this.origin(),
      deviceId: deviceId.toLowerCase(),
      publicKey,
      fingerprint: await deviceKeyFingerprint(publicKey),
    };
  }
  private async request(
    path: string,
    input?: unknown,
    csrf?: string,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`/api/pilot/${path}`, {
        method: input === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers:
          input === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                ...(csrf ? { "x-csrf-token": csrf } : {}),
              },
        body: input === undefined ? undefined : JSON.stringify(input),
      });
    } catch {
      throw new PilotRequestError(503);
    }
    if (!response.ok) throw new PilotRequestError(response.status);
    try {
      return await response.json();
    } catch {
      throw new PilotRequestError(503);
    }
  }
  private async session() {
    const value = (await this.request("auth/csrf")) as {
      accountId?: unknown;
      csrfToken?: unknown;
      deviceId?: unknown;
    };
    if (
      typeof value?.accountId !== "string" ||
      !uuid.test(value.accountId) ||
      typeof value.csrfToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value.csrfToken)
    )
      throw new PilotRequestError(503);
    return {
      accountId: value.accountId,
      csrfToken: value.csrfToken,
      deviceId:
        typeof value.deviceId === "string" && uuid.test(value.deviceId)
          ? value.deviceId
          : undefined,
    };
  }
  async login(input: {
    loginName: string;
    password: string;
    otp: string;
    deviceId: string;
  }) {
    const catalog = new VaultCatalog();
    try {
      const epoch = await catalog.epoch(input.deviceId);
      const challenge = (await this.request("auth/device-challenge", {
        loginName: input.loginName,
        deviceId: input.deviceId,
      })) as { nonce?: unknown; expiresAt?: unknown; mac?: unknown };
      if (
        typeof challenge?.nonce !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge.nonce) ||
        typeof challenge.mac !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge.mac) ||
        typeof challenge.expiresAt !== "number" ||
        !Number.isSafeInteger(challenge.expiresAt)
      )
        throw new PilotRequestError(503);
      const text = JSON.stringify([
        "agri-device-login-v1",
        this.origin(),
        input.loginName.trim(),
        input.deviceId.toLowerCase(),
        challenge.nonce,
        challenge.expiresAt,
      ]);
      let signature: string;
      try {
        signature = await this.keys().sign(
          input.deviceId,
          JSON.stringify([text, challenge.mac]),
        );
      } catch {
        throw new PilotRequestError(401);
      }
      await this.request("auth/login", {
        ...input,
        deviceProof: { ...challenge, signature },
      });
      const context = await this.context();
      if (context.deviceId !== input.deviceId.toLowerCase())
        throw new PilotRequestError(401);
      if (
        !(await catalog.authorize(context.accountId, context.deviceId, epoch))
      )
        throw new PilotRequestError(401);
    } finally {
      catalog.close();
    }
  }

  async context() {
    const result = (await this.request("registration/context")) as {
      geographies?: unknown;
    };
    if (!Array.isArray(result?.geographies)) throw new PilotRequestError(503);
    const parsed = offlineReferenceContextSchema.safeParse({
      ...result,
      geographies: result.geographies.map((value) => ({
        id: value?.id,
        label: value?.name,
      })),
    });
    if (!parsed.success) throw new PilotRequestError(503);
    return parsed.data;
  }
  async registerLand(accountId: string, input: LandRegistration) {
    const value = landRegistrationSchema.parse(input);
    const session = await this.session();
    if (session.accountId !== accountId) throw new PilotRequestError(401);
    const result = landRegistrationResultSchema.safeParse(
      await this.request("land/register", value, session.csrfToken),
    );
    if (!result.success || result.data.landId !== value.landId)
      throw new PilotRequestError(503);
    return result.data;
  }
  async land(after?: string) {
    if (after && !uuid.test(after)) throw new PilotRequestError(400);
    const params = new URLSearchParams({
      limit: "25",
      ...(after ? { after } : {}),
    });
    const result = landPageSchema.safeParse(
      await this.request(`land?${params}`),
    );
    if (!result.success) throw new PilotRequestError(503);
    return result.data;
  }
  async landIdentification(id: string) {
    if (!uuid.test(id)) throw new PilotRequestError(400);
    const result = landDetailSchema.safeParse(
      await this.request(`land/detail?id=${encodeURIComponent(id)}`),
    );
    if (!result.success || result.data.land.id !== id)
      throw new PilotRequestError(503);
    return result.data;
  }
  async landGeographies() {
    const result = landGeographiesSchema.safeParse(
      await this.request("land/geographies"),
    );
    if (!result.success) throw new PilotRequestError(503);
    return result.data;
  }
  async farmerHistory(id: string, cursor?: FarmerHistoryCursor) {
    const parsed = farmerHistoryQuerySchema.safeParse({
      id,
      limit: 25,
      ...cursor,
    });
    if (!parsed.success) throw new PilotRequestError(400);
    const query = new URLSearchParams(
      Object.entries(parsed.data).map(([key, value]) => [key, String(value)]),
    );
    const result = farmerHistoryPageSchema.safeParse(
      await this.request(`farmers/history?${query}`),
    );
    if (!result.success || result.data.farmerId !== id)
      throw new PilotRequestError(503);
    return result.data;
  }
  async changeFarmer(accountId: string, input: FarmerChange) {
    const value = farmerChangeSchema.parse(input);
    const session = await this.session();
    if (session.accountId !== accountId) throw new PilotRequestError(401);
    const result = farmerChangeResultSchema.safeParse(
      await this.request("farmers/change", value, session.csrfToken),
    );
    if (
      !result.success ||
      result.data.farmerId !== input.farmerId ||
      result.data.version !== input.expectedVersion + 1
    )
      throw new PilotRequestError(503);
    return result.data;
  }
  async farmers(after?: string) {
    const query = new URLSearchParams({
      limit: "25",
      ...(after ? { after } : {}),
    });
    const value = farmerPageSchema.safeParse(
      await this.request(`farmers?${query}`),
    );
    if (!value.success) throw new PilotRequestError(503);
    return value.data;
  }
  async farmer(id: string) {
    if (!uuid.test(id)) throw new PilotRequestError(400);
    const value = farmerDetailSchema.safeParse(
      await this.request(`farmers/detail?id=${encodeURIComponent(id)}`),
    );
    if (!value.success) throw new PilotRequestError(503);
    return value.data;
  }
  async register(
    accountId: string,
    input: RegistrationRequest,
    deviceId?: string,
  ): Promise<void> {
    // Always reauthenticate before retrying, including after an ambiguous network failure.
    const session = await this.session();
    if (
      session.accountId !== accountId ||
      (deviceId && session.deviceId !== deviceId)
    )
      throw new PilotRequestError(deviceId ? 401 : 403);
    const result = (await this.request(
      "farmers/register",
      input,
      session.csrfToken,
    )) as { status?: unknown; farmerId?: unknown };
    if (
      result?.status !== "synced" ||
      result.farmerId !== input.farmer.farmerId
    )
      throw new PilotRequestError(503);
  }
  async sendRegistration(
    accountId: string,
    deviceId: string,
    mutationId: string,
    farmer: FarmerRegistration,
  ): Promise<SyncResult> {
    try {
      await this.register(accountId, { mutationId, farmer }, deviceId);
      return { status: "synced" };
    } catch (error) {
      if (error instanceof PilotRequestError && error.status === 409)
        return { status: "conflict" };
      if (
        error instanceof PilotRequestError &&
        [400, 403].includes(error.status)
      )
        return { status: "rejected" };
      throw error;
    }
  }
  async logout(known?: { accountId: string; deviceId: string }) {
    const bindings = known ? [known] : [];
    try {
      const session = await this.session();
      if (session.deviceId)
        bindings.push({
          accountId: session.accountId,
          deviceId: session.deviceId,
        });
      await this.request("auth/logout", {}, session.csrfToken);
    } finally {
      const catalog = new VaultCatalog();
      try {
        for (const binding of bindings)
          await catalog.suspend(binding.accountId, binding.deviceId);
      } finally {
        catalog.close();
      }
    }
  }
}
