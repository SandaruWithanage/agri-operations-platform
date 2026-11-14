import {
  deviceProofSchema,
  deviceChallengeSchema,
} from "../authentication/device-proof";
import { z } from "zod";
import type { VerifiedActor } from "../authorization/transaction-context";
import type { RegistrationSource } from "../farmer/registration-service";

export const deviceChallengeRequestSchema = z
  .object({
    loginName: z.string().trim().min(1).max(200),
    deviceId: z.string().uuid(),
  })
  .strict();
export const pilotLoginSchema = z
  .object({
    loginName: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(1024),
    otp: z.string().regex(/^\d{6}$/),
    deviceId: z.string().uuid(),
    deviceProof: deviceProofSchema,
  })
  .strict();
export interface PilotRuntime {
  readonly internalKey: string;
  deviceChallenge(
    input: z.infer<typeof deviceChallengeRequestSchema>,
    origin: string,
  ): z.infer<typeof deviceChallengeSchema>;
  login(
    input: z.infer<typeof pilotLoginSchema>,
    clientKey: string,
    origin: string,
  ): Promise<{ cookie: string }>;
  csrf(secret: string): Promise<{ csrfToken: string; accountId: string }>;
  token(secret: string): Promise<{ accessToken: string }>;
  logout(secret: string, origin: string, csrf: string): Promise<void>;
  authenticate(token: string): Promise<VerifiedActor>;
  assertCsrf(actor: VerifiedActor, origin: string, csrf: string): void;
  register(
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ): Promise<{ farmerId: string; replayed: boolean }>;
  geographies(
    actor: VerifiedActor,
    source: RegistrationSource,
  ): Promise<Array<{ id: string; name: string }>>;
  close(): Promise<void>;
}
export const PILOT_RUNTIME = Symbol("PILOT_RUNTIME");
