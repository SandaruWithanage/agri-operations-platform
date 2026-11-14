import { DeviceKeys, deviceKeyFingerprint } from "@agri/sync-client";
import type { FarmerRegistration } from "@agri/validation";

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
    };
    if (
      typeof value?.accountId !== "string" ||
      !uuid.test(value.accountId) ||
      typeof value.csrfToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value.csrfToken)
    )
      throw new PilotRequestError(503);
    return { accountId: value.accountId, csrfToken: value.csrfToken };
  }
  async login(input: {
    loginName: string;
    password: string;
    otp: string;
    deviceId: string;
  }) {
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
  }
  async context() {
    const session = await this.session();
    const result = await this.request("registration/geographies");
    if (
      !Array.isArray(result) ||
      result.some(
        (value) =>
          typeof value?.id !== "string" ||
          !uuid.test(value.id) ||
          typeof value?.name !== "string",
      )
    )
      throw new PilotRequestError(503);
    return {
      accountId: session.accountId,
      geographies: result.map((value) => ({
        id: value.id as string,
        label: value.name as string,
      })),
    };
  }
  async register(accountId: string, input: RegistrationRequest): Promise<void> {
    // Always reauthenticate before retrying, including after an ambiguous network failure.
    const session = await this.session();
    if (session.accountId !== accountId) throw new PilotRequestError(403);
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
  async logout() {
    const session = await this.session();
    await this.request("auth/logout", {}, session.csrfToken);
  }
}
