// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { LoginCoordinator } from "../src/authentication/login-coordinator";
import { SessionIssuanceDeniedError } from "../src/authentication/postgres-session-issuer";
const account = {
  accountId: "a50456eb-af66-41f0-8c38-0bc827249cd2",
  passwordHash: "$argon2id$synthetic",
  active: true,
};
const input = {
  loginName: " synthetic ",
  password: "test-password",
  otp: "123456",
  deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
  trustedClientKey: "synthetic-ip-key",
};
async function setup() {
  const credentials = { find: vi.fn().mockResolvedValue(account) };
  const passwords = { verify: vi.fn().mockResolvedValue(true) };
  const mfa = { verify: vi.fn().mockResolvedValue(true) };
  const limiter = { consume: vi.fn().mockResolvedValue(true) };
  const issuer = {
    issue: vi
      .fn()
      .mockResolvedValue({ sessionId: "synthetic", cookie: "synthetic" }),
  };
  const coordinator = await LoginCoordinator.create(
    credentials,
    passwords,
    mfa,
    limiter,
    issuer,
    { idleSeconds: 300, absoluteSeconds: 3600 },
  );
  return { coordinator, credentials, passwords, mfa, limiter, issuer };
}
describe("unwired login coordinator", () => {
  it("uses only the account returned by credential lookup after password and MFA checks", async () => {
    const { coordinator, credentials, passwords, mfa, issuer } = await setup();
    const maliciousInput = { ...input, accountId: "attacker-selected" };
    await coordinator.login(maliciousInput);
    expect(credentials.find).toHaveBeenCalledWith("synthetic");
    expect(passwords.verify).toHaveBeenCalledWith(
      input.password,
      account.passwordHash,
    );
    expect(mfa.verify).toHaveBeenCalledWith(account.accountId, input.otp);
    expect(issuer.issue).toHaveBeenCalledWith(
      {
        accountId: account.accountId,
        deviceId: input.deviceId,
        deviceRequired: true,
      },
      { idleSeconds: 300, absoluteSeconds: 3600 },
    );
  });
  it("performs password work for a missing account and returns a generic failure", async () => {
    const { coordinator, credentials, passwords, mfa, issuer } = await setup();
    credentials.find.mockResolvedValue(null);
    await expect(coordinator.login(input)).rejects.toThrow(
      "Invalid credentials",
    );
    expect(passwords.verify.mock.calls[0][1]).toMatch(/^\$argon2id\$/);
    expect(mfa.verify).not.toHaveBeenCalled();
    expect(issuer.issue).not.toHaveBeenCalled();
  });
  it("rejects inactive accounts, wrong passwords and failed MFA before session issuance", async () => {
    const first = await setup();
    first.credentials.find.mockResolvedValue({ ...account, active: false });
    await expect(first.coordinator.login(input)).rejects.toThrow(
      "Invalid credentials",
    );
    expect(first.issuer.issue).not.toHaveBeenCalled();
    const second = await setup();
    second.passwords.verify.mockResolvedValue(false);
    await expect(second.coordinator.login(input)).rejects.toThrow(
      "Invalid credentials",
    );
    expect(second.issuer.issue).not.toHaveBeenCalled();
    const third = await setup();
    third.mfa.verify.mockResolvedValue(false);
    await expect(third.coordinator.login(input)).rejects.toThrow(
      "Invalid credentials",
    );
    expect(third.issuer.issue).not.toHaveBeenCalled();
  });
  it("returns a generic failure when the issuer rejects a device", async () => {
    const { coordinator, issuer } = await setup();
    issuer.issue.mockRejectedValue(new SessionIssuanceDeniedError());
    await expect(coordinator.login(input)).rejects.toThrow(
      "Invalid credentials",
    );
  });
  it("denies attempts when the shared throttle rejects them", async () => {
    const { coordinator, limiter, credentials } = await setup();
    limiter.consume.mockResolvedValue(false);
    await expect(coordinator.login(input)).rejects.toThrow(
      "Invalid credentials",
    );
    expect(credentials.find).not.toHaveBeenCalled();
  });
});
