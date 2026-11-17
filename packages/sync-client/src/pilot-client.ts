import {
  projectChangeSchema,
  projectChangeResultSchema,
  type ProjectChange,
  projectRegistrationSchema,
  projectRegistrationResultSchema,
  projectQuerySchema,
  projectDetailSchema,
  projectPageSchema,
  projectOrganizationsSchema,
  type ProjectRegistration,
} from "@agri/validation";
import {
  enrollmentCreateSchema,
  enrollmentWithdrawSchema,
  enrollmentResultSchema,
  enrollmentQuerySchema,
  enrollmentPageSchema,
  enrollmentDetailSchema,
  enrollmentPolicySetSchema,
  enrollmentPolicyQuerySchema,
  enrollmentPolicyResultSchema,
  enrollmentPolicyDetailSchema,
  type EnrollmentCreate,
  type EnrollmentWithdraw,
  type EnrollmentPolicySet,
} from "@agri/validation";
import {
  landRegistrationSchema,
  landRegistrationResultSchema,
  landPageSchema,
  landDetailSchema,
  landGeographiesSchema,
  landGeometryRecordSchema,
  landGeometryResultSchema,
  landGeometryReadSchema,
  landViewportSchema,
  type LandGeometryRecord,
  type LandRegistration,
} from "@agri/validation";
import {
  farmerHistoryQuerySchema,
  farmerHistoryPageSchema,
  type FarmerHistoryCursor,
} from "@agri/validation";
import {
  farmerCorrectionGeographiesSchema,
  farmerCorrectionGeographiesQuerySchema,
  farmerChangeSchema,
  farmerChangeResultSchema,
  type FarmerChange,
  farmerPageSchema,
  farmerListQuerySchema,
  farmerListFiltersSchema,
  sameFarmerFilters,
  type FarmerListFilters,
  farmerDetailSchema,
  farmerVerificationReceiptSchema,
  farmerCorrectionReceiptSchema,
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
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`/api/pilot/${path}`, {
        method: input === undefined ? "GET" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
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
  private async session(signal?: AbortSignal) {
    const value = (await this.request(
      "auth/csrf",
      undefined,
      undefined,
      signal,
    )) as {
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
  /** Fresh authenticated account/device only; never returns the CSRF/session secret. */
  async sessionIdentity(signal?: AbortSignal) {
    const session = await this.session(signal);
    if (!session.deviceId) throw new PilotRequestError(401);
    return { accountId: session.accountId, deviceId: session.deviceId };
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

  async context(signal?: AbortSignal) {
    const result = (await this.request(
      "registration/context",
      undefined,
      undefined,
      signal,
    )) as {
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
  async changeProject(
    accountId: string,
    input: ProjectChange,
    expectedDeviceId: string,
  ) {
    if (!uuid.test(expectedDeviceId)) throw new PilotRequestError(400);
    const value = projectChangeSchema.parse(input),
      session = await this.session();
    if (
      session.accountId !== accountId ||
      session.deviceId !== expectedDeviceId.toLowerCase()
    )
      throw new PilotRequestError(401);
    const result = projectChangeResultSchema.safeParse(
      await this.request("projects/change", value, session.csrfToken),
    );
    if (
      !result.success ||
      result.data.projectId !== value.projectId ||
      result.data.version !== value.expectedVersion + 1
    )
      throw new PilotRequestError(503);
    return result.data;
  }
  async registerProject(
    accountId: string,
    input: ProjectRegistration,
    expectedDeviceId: string,
  ) {
    if (!uuid.test(expectedDeviceId)) throw new PilotRequestError(400);
    const value = projectRegistrationSchema.parse(input),
      session = await this.session();
    if (
      session.accountId !== accountId ||
      session.deviceId !== expectedDeviceId.toLowerCase()
    )
      throw new PilotRequestError(401);
    const result = projectRegistrationResultSchema.safeParse(
      await this.request("projects/register", value, session.csrfToken),
    );
    if (!result.success || result.data.projectId !== value.projectId)
      throw new PilotRequestError(503);
    return result.data;
  }
  async projects(after?: string, signal?: AbortSignal) {
    const query = projectQuerySchema.safeParse({
      limit: 25,
      ...(after ? { after } : {}),
    });
    if (!query.success) throw new PilotRequestError(400);
    const params = new URLSearchParams(
      Object.entries(query.data).map(([key, value]) => [key, String(value)]),
    );
    const result = projectPageSchema.safeParse(
      await this.request(`projects?${params}`, undefined, undefined, signal),
    );
    if (!result.success || result.data.items.length > query.data.limit)
      throw new PilotRequestError(503);
    return result.data;
  }
  async project(id: string, signal?: AbortSignal) {
    if (!uuid.test(id)) throw new PilotRequestError(400);
    const result = projectDetailSchema.safeParse(
      await this.request(
        `projects/detail?id=${encodeURIComponent(id)}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (!result.success || result.data.project.id !== id.toLowerCase())
      throw new PilotRequestError(503);
    return result.data;
  }
  async projectOrganizations(signal?: AbortSignal) {
    const result = projectOrganizationsSchema.safeParse(
      await this.request(
        "projects/organizations",
        undefined,
        undefined,
        signal,
      ),
    );
    if (!result.success) throw new PilotRequestError(503);
    return result.data;
  }
  private async command<S extends { parse(input: unknown): unknown }>(
    accountId: string,
    expectedDeviceId: string,
    schema: S,
    input: unknown,
  ) {
    if (!uuid.test(expectedDeviceId)) throw new PilotRequestError(400);
    const value = schema.parse(input),
      session = await this.session();
    if (
      session.accountId !== accountId ||
      session.deviceId !== expectedDeviceId.toLowerCase()
    )
      throw new PilotRequestError(401);
    return { value, csrf: session.csrfToken };
  }
  async enrollFarmer(
    accountId: string,
    input: EnrollmentCreate,
    expectedDeviceId: string,
  ) {
    const { value, csrf } = await this.command(
      accountId,
      expectedDeviceId,
      enrollmentCreateSchema,
      input,
    );
    const sent = value as ReturnType<typeof enrollmentCreateSchema.parse>;
    const result = enrollmentResultSchema.safeParse(
      await this.request("enrollments/enroll", sent, csrf),
    );
    if (
      !result.success ||
      result.data.enrollmentId !== sent.enrollmentId ||
      result.data.version !== 1
    )
      throw new PilotRequestError(503);
    return result.data;
  }
  async withdrawEnrollment(
    accountId: string,
    input: EnrollmentWithdraw,
    expectedDeviceId: string,
  ) {
    const { value, csrf } = await this.command(
      accountId,
      expectedDeviceId,
      enrollmentWithdrawSchema,
      input,
    );
    const sent = value as ReturnType<typeof enrollmentWithdrawSchema.parse>;
    const result = enrollmentResultSchema.safeParse(
      await this.request("enrollments/withdraw", sent, csrf),
    );
    if (
      !result.success ||
      result.data.enrollmentId !== sent.enrollmentId ||
      result.data.version !== sent.expectedVersion + 1
    )
      throw new PilotRequestError(503);
    return result.data;
  }
  async setEnrollmentPolicy(
    accountId: string,
    input: EnrollmentPolicySet,
    expectedDeviceId: string,
  ) {
    const { value, csrf } = await this.command(
      accountId,
      expectedDeviceId,
      enrollmentPolicySetSchema,
      input,
    );
    const sent = value as ReturnType<typeof enrollmentPolicySetSchema.parse>;
    const result = enrollmentPolicyResultSchema.safeParse(
      await this.request("enrollment-policies/set", sent, csrf),
    );
    if (
      !result.success ||
      result.data.projectId !== sent.projectId ||
      result.data.version !== sent.expectedVersion + 1
    )
      throw new PilotRequestError(503);
    return result.data;
  }
  async enrollments(
    filters: { projectId?: string; farmerId?: string; status?: string } = {},
    after?: string,
    signal?: AbortSignal,
  ) {
    const query = enrollmentQuerySchema.safeParse({
      limit: 25,
      ...filters,
      ...(after ? { after } : {}),
    });
    if (!query.success) throw new PilotRequestError(400);
    const params = new URLSearchParams(
      Object.entries(query.data).map(([key, value]) => [key, String(value)]),
    );
    const result = enrollmentPageSchema.safeParse(
      await this.request(`enrollments?${params}`, undefined, undefined, signal),
    );
    if (
      !result.success ||
      result.data.items.length > query.data.limit ||
      result.data.items.some(
        (row) =>
          (query.data.projectId && row.projectId !== query.data.projectId) ||
          (query.data.farmerId && row.farmerId !== query.data.farmerId) ||
          (query.data.status && row.status !== query.data.status),
      )
    )
      throw new PilotRequestError(503);
    return result.data;
  }
  async enrollment(id: string, signal?: AbortSignal) {
    if (!uuid.test(id)) throw new PilotRequestError(400);
    const result = enrollmentDetailSchema.safeParse(
      await this.request(
        `enrollments/detail?id=${encodeURIComponent(id)}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (!result.success || result.data.enrollment.id !== id.toLowerCase())
      throw new PilotRequestError(503);
    return result.data;
  }
  async enrollmentPolicy(projectId: string, signal?: AbortSignal) {
    const query = enrollmentPolicyQuerySchema.safeParse({ projectId });
    if (!query.success) throw new PilotRequestError(400);
    const result = enrollmentPolicyDetailSchema.safeParse(
      await this.request(
        `enrollment-policies?projectId=${encodeURIComponent(query.data.projectId)}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (
      !result.success ||
      result.data.projectId !== query.data.projectId ||
      (result.data.policy !== null &&
        result.data.policy.projectId !== query.data.projectId)
    )
      throw new PilotRequestError(503);
    return result.data;
  }
  async registerLand(
    accountId: string,
    input: LandRegistration,
    expectedDeviceId?: string,
  ) {
    if (expectedDeviceId !== undefined && !uuid.test(expectedDeviceId))
      throw new PilotRequestError(400);
    const value = landRegistrationSchema.parse(input);
    const session = await this.session();
    if (
      session.accountId !== accountId ||
      (expectedDeviceId !== undefined && session.deviceId !== expectedDeviceId)
    )
      throw new PilotRequestError(401);
    const result = landRegistrationResultSchema.safeParse(
      await this.request("land/register", value, session.csrfToken),
    );
    if (!result.success || result.data.landId !== value.landId)
      throw new PilotRequestError(503);
    return result.data;
  }
  async land(after?: string, signal?: AbortSignal) {
    if (after && !uuid.test(after)) throw new PilotRequestError(400);
    const params = new URLSearchParams({
      limit: "25",
      ...(after ? { after } : {}),
    });
    const result = landPageSchema.safeParse(
      await this.request(`land?${params}`, undefined, undefined, signal),
    );
    if (!result.success) throw new PilotRequestError(503);
    return result.data;
  }
  async landIdentification(id: string, signal?: AbortSignal) {
    if (!uuid.test(id)) throw new PilotRequestError(400);
    const result = landDetailSchema.safeParse(
      await this.request(
        `land/detail?id=${encodeURIComponent(id)}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (!result.success || result.data.land.id !== id)
      throw new PilotRequestError(503);
    return result.data;
  }
  async recordLandGeometry(
    accountId: string,
    input: LandGeometryRecord,
    expectedDeviceId?: string,
  ) {
    if (expectedDeviceId !== undefined && !uuid.test(expectedDeviceId))
      throw new PilotRequestError(400);
    const value = landGeometryRecordSchema.parse(input);
    const session = await this.session();
    if (
      session.accountId !== accountId ||
      (expectedDeviceId !== undefined && session.deviceId !== expectedDeviceId)
    )
      throw new PilotRequestError(401);
    const result = landGeometryResultSchema.safeParse(
      await this.request("land/geometry", value, session.csrfToken),
    );
    if (!result.success || result.data.landId !== value.landId)
      throw new PilotRequestError(503);
    return result.data;
  }
  async landGeometry(landId: string, history = false, signal?: AbortSignal) {
    if (!uuid.test(landId)) throw new PilotRequestError(400);
    const result = landGeometryReadSchema.safeParse(
      await this.request(
        `land/geometry?landId=${encodeURIComponent(landId)}&history=${history}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (!result.success || result.data.landId !== landId)
      throw new PilotRequestError(503);
    return result.data;
  }
  /** Bounded viewport read; pass an AbortSignal so a pan or zoom cancels the stale request. */
  async landViewport(
    box: { west: number; south: number; east: number; north: number },
    limit = 100,
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams({
      west: String(box.west),
      south: String(box.south),
      east: String(box.east),
      north: String(box.north),
      limit: String(limit),
    });
    const result = landViewportSchema.safeParse(
      await this.request(
        `land/viewport?${params}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (
      !result.success ||
      result.data.bbox.west !== box.west ||
      result.data.bbox.south !== box.south ||
      result.data.bbox.east !== box.east ||
      result.data.bbox.north !== box.north
    )
      throw new PilotRequestError(503);
    return result.data;
  }
  async landGeographies(signal?: AbortSignal) {
    const result = landGeographiesSchema.safeParse(
      await this.request("land/geographies", undefined, undefined, signal),
    );
    if (!result.success) throw new PilotRequestError(503);
    return result.data;
  }
  async farmerHistory(
    id: string,
    cursor?: FarmerHistoryCursor,
    signal?: AbortSignal,
  ) {
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
      await this.request(
        `farmers/history?${query}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (!result.success || result.data.farmerId !== id)
      throw new PilotRequestError(503);
    return result.data;
  }
  async farmerCorrectionGeographies(
    id: string,
    after?: string,
    signal?: AbortSignal,
  ) {
    const query = farmerCorrectionGeographiesQuerySchema.safeParse({
      id,
      ...(after ? { after } : {}),
      limit: 50,
    });
    if (!query.success) throw new PilotRequestError(400);
    const params = new URLSearchParams(
      Object.entries(query.data).map(([key, value]) => [key, String(value)]),
    );
    const page = farmerCorrectionGeographiesSchema.safeParse(
      await this.request(
        `farmers/correction-geographies?${params}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (
      !page.success ||
      page.data.farmerId.toLowerCase() !== id.toLowerCase() ||
      page.data.geographies.length > 50
    )
      throw new PilotRequestError(503);
    return page.data;
  }
  async farmerVerificationReceipt(id: string, signal?: AbortSignal) {
    if (!uuid.test(id)) throw new PilotRequestError(400);
    const result = farmerVerificationReceiptSchema.safeParse(
      await this.request(
        `farmers/verification-receipt?id=${encodeURIComponent(id)}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (!result.success || result.data.farmerId !== id)
      throw new PilotRequestError(503);
    return result.data;
  }
  async farmerCorrectionReceipt(id: string, signal?: AbortSignal) {
    if (!uuid.test(id)) throw new PilotRequestError(400);
    const result = farmerCorrectionReceiptSchema.safeParse(
      await this.request(
        `farmers/correction-receipt?id=${encodeURIComponent(id)}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (!result.success || result.data.farmerId !== id)
      throw new PilotRequestError(503);
    return result.data;
  }
  async changeFarmer(
    accountId: string,
    input: FarmerChange,
    expectedDeviceId?: string,
  ) {
    const value = farmerChangeSchema.parse(input);
    if (expectedDeviceId !== undefined && !uuid.test(expectedDeviceId))
      throw new PilotRequestError(400);
    const session = await this.session();
    if (
      session.accountId !== accountId ||
      (expectedDeviceId !== undefined && session.deviceId !== expectedDeviceId)
    )
      throw new PilotRequestError(401);
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
  async farmers(
    after?: string,
    signal?: AbortSignal,
    filters: FarmerListFilters = {},
  ) {
    const selected = farmerListFiltersSchema.safeParse(filters);
    if (!selected.success) throw new PilotRequestError(400);
    const parsed = farmerListQuerySchema.safeParse({
      limit: 25,
      ...(after ? { after } : {}),
      ...selected.data,
    });
    if (!parsed.success) throw new PilotRequestError(400);
    const query = new URLSearchParams(
      Object.entries(parsed.data)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
    const value = farmerPageSchema.safeParse(
      await this.request(`farmers?${query}`, undefined, undefined, signal),
    );
    if (!value.success || !sameFarmerFilters(parsed.data, value.data.filters))
      throw new PilotRequestError(503);
    return value.data;
  }
  async farmer(id: string, signal?: AbortSignal) {
    if (!uuid.test(id)) throw new PilotRequestError(400);
    const value = farmerDetailSchema.safeParse(
      await this.request(
        `farmers/detail?id=${encodeURIComponent(id)}`,
        undefined,
        undefined,
        signal,
      ),
    );
    if (!value.success || value.data.farmer.id !== id)
      throw new PilotRequestError(503);
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
