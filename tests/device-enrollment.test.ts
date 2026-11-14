// @vitest-environment node
import { createHash, generateKeyPairSync } from "node:crypto";
import { expect, it } from "vitest";
import { validateEnrollment } from "../scripts/device-enrollment.mjs";
const origin = "https://field.example.test";
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKey = pair.publicKey.export({ format: "jwk" });
const fingerprint = createHash("sha256")
  .update(
    JSON.stringify({
      crv: publicKey.crv,
      kty: publicKey.kty,
      x: publicKey.x,
      y: publicKey.y,
    }),
  )
  .digest("hex");
const request = {
  version: 1,
  origin,
  deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
  publicKey,
  fingerprint,
};
it("accepts only a public key matching the independent origin and verification code", () => {
  expect(validateEnrollment(request, origin, fingerprint)).toEqual({
    deviceId: request.deviceId,
    publicKey,
  });
  expect(() =>
    validateEnrollment(request, "https://another.example.test", fingerprint),
  ).toThrow();
  expect(() => validateEnrollment(request, origin, "0".repeat(64))).toThrow();
  expect(() =>
    validateEnrollment(
      { ...request, publicKey: pair.privateKey.export({ format: "jwk" }) },
      origin,
      fingerprint,
    ),
  ).toThrow("public P-256");
  expect(() =>
    validateEnrollment(
      { ...request, accountId: "attacker" },
      origin,
      fingerprint,
    ),
  ).toThrow();
  expect(() =>
    validateEnrollment(
      { ...request, origin: "http://field.example.test" },
      "http://field.example.test",
      fingerprint,
    ),
  ).toThrow("HTTPS");
});
