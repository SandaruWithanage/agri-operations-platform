import { z } from "zod";
const bytes = (min: number, max = min) =>
  z
    .object({
      bytes: z.array(z.number().int().min(0).max(255)).min(min).max(max),
    })
    .strict();
const configuration = z
  .object({
    id: z.literal("vault"),
    salt: bytes(16),
    iv: bytes(12),
    verifier: bytes(16, 128),
    iterations: z.number().int().min(310000).max(2000000).optional(),
  })
  .strict();
const encryptedValue = z
  .object({
    id: z.string().min(1).max(100),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    iv: bytes(12),
    ciphertext: bytes(16, 6000000),
  })
  .strict();
export const encryptedArchiveContentsSchema = z
  .object({
    version: z.literal(1),
    database: z
      .string()
      .regex(/^agri-registration-v1-[0-9a-f-]{36}-[0-9a-f-]{36}$/),
    config: z.array(configuration).length(1),
    mutations: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            status: z.enum([
              "saved-on-device",
              "pending-sync",
              "synced",
              "conflict",
              "rejected",
            ]),
            iv: bytes(12),
            ciphertext: bytes(16, 4096),
            fingerprint: z
              .string()
              .regex(/^[0-9a-f]{64}$/)
              .optional(),
          })
          .strict(),
      )
      .max(5000),
    working: z.array(encryptedValue).max(100),
    metadata: z.array(encryptedValue).length(1),
    recovery: encryptedValue.nullable(),
  })
  .strict();
export const encryptedArchiveEnvelopeSchema = z
  .object({
    format: z.literal("agri-encrypted-archive"),
    version: z.literal(2),
    database: z.string().max(100),
    salt: bytes(16),
    iterations: z.number().int().min(310000).max(2000000),
    iv: bytes(12),
    ciphertext: z
      .string()
      .min(22)
      .max(8500000)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type EncryptedArchiveContents = z.infer<
  typeof encryptedArchiveContentsSchema
>;
