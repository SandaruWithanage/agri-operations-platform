import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  HttpCode,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { ZodError } from "zod";
import {
  PILOT_RUNTIME,
  pilotLoginSchema,
  deviceChallengeRequestSchema,
  type PilotRuntime,
} from "./contracts";

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
        error instanceof BadRequestException
      )
        throw error;
      const code = (error as { code?: unknown })?.code;
      if (code === "42501") throw new ForbiddenException("Action denied");
      if (code === "23505") throw new ConflictException("Mutation conflict");
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
    @Req() req: Request,
  ) {
    const runtime = this.trusted(key);
    return this.safe(async () => {
      const data = pilotLoginSchema.parse(input);
      try {
        return await runtime.login(
          data,
          req.socket.remoteAddress ?? "unknown-bff",
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
