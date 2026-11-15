import type {
  LandPage,
  LandDetail,
  LandRegistrationResult,
  LandGeographies,
  FarmerHistoryPage,
  FarmerPage,
  FarmerDetail,
  FarmerChangeResult,
  FarmerCorrectionGeographies,
  FarmerVerificationReceipt,
  FarmerCorrectionReceipt,
} from "@agri/validation";
import {
  deviceProofSchema,
  deviceChallengeSchema,
} from "../authentication/device-proof";
import { z } from "zod";
import type { VerifiedActor } from "../authorization/transaction-context";
import type { RegistrationSource } from "../authorization/registration-source";

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
export type RegistrationContext = {
  accountId: string;
  deviceId: string;
  deviceKeyFingerprint: string;
  verifiedAt: number;
  offlineUntil: number;
  geographies: Array<{ id: string; name: string }>;
};
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
  csrf(
    secret: string,
  ): Promise<{ csrfToken: string; accountId: string; deviceId: string }>;
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
  context(
    actor: VerifiedActor,
    source: RegistrationSource,
  ): Promise<RegistrationContext>;
  changeFarmer(
    actor: VerifiedActor,
    input: unknown,
  ): Promise<FarmerChangeResult>;
  farmerHistory(
    actor: VerifiedActor,
    input: unknown,
  ): Promise<FarmerHistoryPage>;
  listFarmers(actor: VerifiedActor, input: unknown): Promise<FarmerPage>;
  farmerCorrectionGeographies(
    actor: VerifiedActor,
    input: unknown,
  ): Promise<FarmerCorrectionGeographies>;
  farmerVerificationReceipt(
    actor: VerifiedActor,
    input: unknown,
  ): Promise<FarmerVerificationReceipt>;
  farmerCorrectionReceipt(
    actor: VerifiedActor,
    input: unknown,
  ): Promise<FarmerCorrectionReceipt>;
  farmerDetail(actor: VerifiedActor, input: unknown): Promise<FarmerDetail>;
  registerLand(
    actor: VerifiedActor,
    source: RegistrationSource,
    input: unknown,
  ): Promise<LandRegistrationResult>;
  listLand(actor: VerifiedActor, input: unknown): Promise<LandPage>;
  landDetail(actor: VerifiedActor, input: unknown): Promise<LandDetail>;
  landGeographies(
    actor: VerifiedActor,
    source: RegistrationSource,
  ): Promise<LandGeographies>;
  readiness(): Promise<boolean>;
  close(): Promise<void>;
}
export const PILOT_RUNTIME = Symbol("PILOT_RUNTIME");
