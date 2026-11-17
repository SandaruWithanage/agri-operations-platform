import { projectOrganizationsQuerySchema } from "@agri/validation";
import {
  Body,
  Query,
  NotFoundException,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  HttpCode,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { ZodError } from "zod";
import {
  PILOT_RUNTIME,
  pilotLoginSchema,
  deviceChallengeRequestSchema,
  type PilotRuntime,
} from "./contracts";

/**
 * The client address comes only from the BFF, which the shared internal key has already authenticated, and only
 * when the BFF is configured with a trusted proxy depth. Anything else (absent, malformed, not an IP literal) falls
 * into one shared "unattributed" bucket. The API never uses its own socket address, which is the BFF's, so one BFF
 * can no longer stand in for every officer.
 */
export function clientThrottleKey(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate || candidate.length > 45 || isIP(candidate) === 0)
    return "unattributed";
  return `ip:${candidate.toLowerCase()}`;
}
@Controller("pilot")
export class PilotController {
  constructor(
    @Inject(PILOT_RUNTIME) private readonly runtime: PilotRuntime | null,
  ) {}
  private trusted(key?: string): PilotRuntime {
    if (!this.runtime)
      throw new ServiceUnavailableException(
        "Pilot authentication is not configured",
      );
    if (
      !key ||
      key.length > 512 ||
      !timingSafeEqual(
        createHash("sha256").update(key).digest(),
        createHash("sha256").update(this.runtime.internalKey).digest(),
      )
    )
      throw new UnauthorizedException();
    return this.runtime;
  }
  private secret(value?: string): string {
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value))
      throw new UnauthorizedException();
    return value;
  }
  private bearer(value?: string): string {
    if (!value?.startsWith("Bearer ") || value.length > 16384)
      throw new UnauthorizedException();
    return value.slice(7);
  }
  private source(value?: string): "field_officer" | "administrator" {
    if (value !== "field_officer" && value !== "administrator")
      throw new BadRequestException();
    return value;
  }
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ZodError)
        throw new BadRequestException("Invalid input");
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      )
        throw error;
      const code = (error as { code?: unknown })?.code;
      if (code === "22023") throw new BadRequestException("Invalid input");
      if (code === "42501") throw new ForbiddenException("Action denied");
      // Provisional enrollment eligibility/state conflicts (inactive, already enrolled, not current).
      if (code === "55000")
        throw new ConflictException("Enrollment state conflict");
      if (code === "23505" || code === "40001")
        throw new ConflictException("Mutation conflict");
      throw new ServiceUnavailableException("Request could not be completed");
    }
  }
  @Post("auth/device-challenge")
  @HttpCode(200)
  deviceChallenge(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      try {
        return runtime.deviceChallenge(
          deviceChallengeRequestSchema.parse(input),
          origin ?? "",
        );
      } catch (error) {
        if ((error as Error)?.message === "Invalid credentials")
          throw new UnauthorizedException();
        throw error;
      }
    });
  }
  @Post("auth/login")
  @HttpCode(200)
  login(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Body() input: unknown,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-agri-client") client: string | undefined,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const data = pilotLoginSchema.parse(input);
      try {
        return await runtime.login(
          data,
          clientThrottleKey(client),
          origin ?? "",
        );
      } catch (error) {
        if ((error as Error)?.message === "Invalid credentials")
          throw new UnauthorizedException("Invalid credentials");
        throw error;
      }
    });
  }
  @Post("auth/csrf")
  @HttpCode(200)
  csrf(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("x-agri-session") secret: string | undefined,
  ) {
    const runtime = this.trusted(key);
    return this.safe(() => runtime.csrf(this.secret(secret)));
  }
  @Post("auth/token")
  @HttpCode(200)
  token(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("x-agri-session") secret: string | undefined,
  ) {
    const runtime = this.trusted(key);
    return this.safe(() => runtime.token(this.secret(secret)));
  }
  @Post("auth/logout")
  @HttpCode(200)
  logout(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("x-agri-session") secret: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      await runtime.logout(this.secret(secret), origin ?? "", csrf ?? "");
      return { loggedOut: true };
    });
  }
  @Post("farmers/register")
  @HttpCode(200)
  register(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      runtime.assertCsrf(actor, origin ?? "", csrf ?? "");
      return {
        status: "synced",
        ...(await runtime.register(actor, this.source(source), input)),
      };
    });
  }
  @Post("farmers/change")
  @HttpCode(200)
  changeFarmer(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      runtime.assertCsrf(actor, origin ?? "", csrf ?? "");
      return runtime.changeFarmer(actor, input);
    });
  }
  @Post("projects/change")
  @HttpCode(200)
  changeProject(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      runtime.assertCsrf(actor, origin ?? "", csrf ?? "");
      return runtime.changeProject(actor, this.source(source), input);
    });
  }
  @Post("projects/register")
  @HttpCode(200)
  registerProject(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      runtime.assertCsrf(actor, origin ?? "", csrf ?? "");
      return runtime.registerProject(actor, this.source(source), input);
    });
  }
  @Get("projects")
  listProjects(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.listProjects(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("projects/detail")
  projectDetail(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
    @Headers("x-agri-source") source: string | undefined,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.projectDetail(
        await runtime.authenticate(this.bearer(token)),
        query,
        this.source(source),
      ),
    );
  }
  @Get("projects/organizations")
  projectOrganizations(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      projectOrganizationsQuerySchema.parse(query);
      return runtime.projectOrganizations(actor, this.source(source));
    });
  }
  @Post("enrollments/enroll")
  @HttpCode(200)
  enrollFarmer(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      runtime.assertCsrf(actor, origin ?? "", csrf ?? "");
      return runtime.enrollFarmer(actor, this.source(source), input);
    });
  }
  @Post("enrollments/withdraw")
  @HttpCode(200)
  withdrawEnrollment(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      runtime.assertCsrf(actor, origin ?? "", csrf ?? "");
      return runtime.withdrawEnrollment(actor, this.source(source), input);
    });
  }
  @Post("enrollment-policies/set")
  @HttpCode(200)
  setEnrollmentPolicy(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      runtime.assertCsrf(actor, origin ?? "", csrf ?? "");
      return runtime.setEnrollmentPolicy(actor, this.source(source), input);
    });
  }
  @Get("enrollment-policies")
  enrollmentPolicy(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.enrollmentPolicy(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("enrollments")
  listEnrollments(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.listEnrollments(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("enrollments/detail")
  enrollmentDetail(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.enrollmentDetail(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Post("land/register")
  @HttpCode(200)
  registerLand(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      runtime.assertCsrf(actor, origin ?? "", csrf ?? "");
      return runtime.registerLand(actor, this.source(source), input);
    });
  }
  @Get("land")
  listLand(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.listLand(await runtime.authenticate(this.bearer(token)), query),
    );
  }
  @Get("land/detail")
  landDetail(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.landDetail(await runtime.authenticate(this.bearer(token)), query),
    );
  }
  @Post("land/geometry")
  @HttpCode(200)
  recordLandGeometry(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
    @Headers("x-agri-origin") origin: string | undefined,
    @Headers("x-csrf-token") csrf: string | undefined,
    @Body() input: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const actor = await runtime.authenticate(this.bearer(token));
      runtime.assertCsrf(actor, origin ?? "", csrf ?? "");
      return runtime.recordLandGeometry(actor, this.source(source), input);
    });
  }
  @Get("land/geometry")
  landGeometry(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.landGeometry(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("land/viewport")
  landViewport(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.landViewport(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("land/geographies")
  landGeographies(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.landGeographies(
        await runtime.authenticate(this.bearer(token)),
        this.source(source),
      ),
    );
  }
  @Get("farmers")
  listFarmers(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.listFarmers(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("farmers/correction-geographies")
  farmerCorrectionGeographies(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.farmerCorrectionGeographies(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("farmers/verification-receipt")
  farmerVerificationReceipt(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.farmerVerificationReceipt(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("farmers/correction-receipt")
  farmerCorrectionReceipt(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.farmerCorrectionReceipt(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("farmers/history")
  farmerHistory(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.farmerHistory(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("farmers/detail")
  farmerDetail(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Query() query: unknown,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.farmerDetail(
        await runtime.authenticate(this.bearer(token)),
        query,
      ),
    );
  }
  @Get("registration/context")
  context(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.context(
        await runtime.authenticate(this.bearer(token)),
        this.source(source),
      ),
    );
  }
  @Get("registration/geographies")
  geographies(
    @Headers("x-agri-bff-key") key: string | undefined,
    @Headers("authorization") token: string | undefined,
    @Headers("x-agri-source") source: string | undefined,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () =>
      runtime.geographies(
        await runtime.authenticate(this.bearer(token)),
        this.source(source),
      ),
    );
  }
}
