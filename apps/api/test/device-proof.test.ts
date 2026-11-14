// @vitest-environment node
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DeviceProofs,
  deviceSignatureText,
} from "../src/authentication/device-proof";
const origin = "https://field.example.test";
const device = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const account = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
function fixture() {
  let time = Date.now();
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          key_id: device,
          public_jwk: pair.publicKey.export({ format: "jwk" }),
        },
      ],
    })
    .mockResolvedValue({ rows: [{ ok: true }] });
  const service = new DeviceProofs(
    { query },
    Buffer.alloc(32, 7),
    [origin],
    () => time,
  );
  const challenge = service.issue("synthetic", device, origin);
  const proof = {
    ...challenge,
    signature: sign(
      "sha256",
      Buffer.from(deviceSignatureText(origin, "synthetic", device, challenge)),
      { key: pair.privateKey, dsaEncoding: "ieee-p1363" },
    ).toString("base64url"),
  };
  return {
    service,
    proof,
    query,
    advance: () => {
      time += 121000;
    },
  };
}
describe("server device possession proof", () => {
  it("validates a P-256 signature and records only a hash of the single-use challenge", async () => {
    const { service, proof, query } = fixture();
    const assertion = await service.verify(
      account,
      "synthetic",
      device,
      origin,
      proof,
    );
    expect(assertion).toMatch(/^[0-9a-f-]{36}$/);
    expect(query.mock.calls[1][0]).toContain("record_device_assertion");
    expect(query.mock.calls[1][1][4]).toHaveLength(32);
    expect(JSON.stringify(query.mock.calls[1])).not.toContain(proof.signature);
  });
  it("binds proof to origin, account name, device, nonce and expiry before reading a key", async () => {
    for (const change of [
      { login: "other" },
      { device: account },
      { origin: "https://attacker.example.test" },
      { proof: { nonce: "A".repeat(43) } },
      { proof: { expiresAt: 1 } },
      { proof: { mac: "A".repeat(43) } },
    ]) {
      const { service, proof, query } = fixture();
      expect(
        await service.verify(
          account,
          change.login ?? "synthetic",
          change.device ?? device,
          change.origin ?? origin,
          { ...proof, ...change.proof },
        ),
      ).toBeNull();
      expect(query).not.toHaveBeenCalled();
    }
  });
  it("rejects expired proof, missing enrolled keys, invalid signatures and replay rejection by the database", async () => {
    const expired = fixture();
    expired.advance();
    expect(
      await expired.service.verify(
        account,
        "synthetic",
        device,
        origin,
        expired.proof,
      ),
    ).toBeNull();
    const missing = fixture();
    missing.query.mockReset().mockResolvedValue({ rows: [] });
    expect(
      await missing.service.verify(
        account,
        "synthetic",
        device,
        origin,
        missing.proof,
      ),
    ).toBeNull();
    const tampered = fixture();
    expect(
      await tampered.service.verify(account, "synthetic", device, origin, {
        ...tampered.proof,
        signature: "A".repeat(86),
      }),
    ).toBeNull();
    expect(tampered.query).toHaveBeenCalledOnce();
    const replay = fixture();
    replay.query
      .mockReset()
      .mockResolvedValueOnce({
        rows: [
          {
            key_id: device,
            public_jwk: pair.publicKey.export({ format: "jwk" }),
          },
        ],
      })
      .mockResolvedValue({ rows: [{ ok: false }] });
    expect(
      await replay.service.verify(
        account,
        "synthetic",
        device,
        origin,
        replay.proof,
      ),
    ).toBeNull();
  });
  it("does not accept a different device key or a supplied private JWK", async () => {
    for (const public_jwk of [
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({
        format: "jwk",
      }),
      pair.privateKey.export({ format: "jwk" }),
    ]) {
      const { service, proof, query } = fixture();
      query
        .mockReset()
        .mockResolvedValue({ rows: [{ key_id: device, public_jwk }] });
      expect(
        await service.verify(account, "synthetic", device, origin, proof),
      ).toBeNull();
      expect(query).toHaveBeenCalledOnce();
    }
  });
});
