import { randomBytes } from "node:crypto";
import { hashPassword } from "./passwords";
import type { Credential } from "./postgres-credential-reader";
import { SessionIssuanceDeniedError } from "./postgres-session-issuer";
import type {
  AuthenticatedAccount,
  SessionLifetime,
} from "./postgres-session-issuer";

type Devices = {
  verify(
    accountId: string,
    loginName: string,
    deviceId: string | null,
    origin: string,
    proof: unknown,
  ): Promise<string | null>;
};
type Credentials = { find(loginName: string): Promise<Credential | null> };
type Passwords = { verify(password: string, hash: string): Promise<boolean> };
type Mfa = { verify(accountId: string, code: string): Promise<boolean> };
type Limiter = {
  consume(loginName: string, trustedClientKey: string): Promise<boolean>;
};
type Issuer = {
  issue(
    account: AuthenticatedAccount,
    lifetime: SessionLifetime,
  ): Promise<{ sessionId: string; cookie: string }>;
};

/** Internal only; requires a real shared throttle, secure BFF, CSRF and protected credential connections. */
export class LoginCoordinator {
  private constructor(
    private readonly credentials: Credentials,
    private readonly passwords: Passwords,
    private readonly mfa: Mfa,
    private readonly limiter: Limiter,
    private readonly issuer: Issuer,
    private readonly dummyHash: string,
    private readonly lifetime: SessionLifetime,
    private readonly devices: Devices,
  ) {}
  /** Generate a real dummy hash once at startup so unknown-account attempts use Argon2id work. */
  static async create(
    credentials: Credentials,
    passwords: Passwords,
    mfa: Mfa,
    limiter: Limiter,
    issuer: Issuer,
    lifetime: SessionLifetime,
    devices: Devices,
  ): Promise<LoginCoordinator> {
    const dummyHash = await hashPassword(randomBytes(32).toString("base64url"));
    return new LoginCoordinator(
      credentials,
      passwords,
      mfa,
      limiter,
      issuer,
      dummyHash,
      lifetime,
      devices,
    );
  }
  /** Client key must be derived by trusted proxy configuration; account ID is never supplied by the browser. */
  async login(input: {
    loginName: string;
    password: string;
    otp: string;
    deviceId: string | null;
    trustedClientKey: string;
    trustedOrigin: string;
    deviceProof: unknown;
  }): Promise<{ sessionId: string; cookie: string }> {
    const loginName = input.loginName.trim();
    if (
      !loginName ||
      loginName.length > 200 ||
      !input.trustedClientKey ||
      input.trustedClientKey.length > 200
    )
      throw new Error("Invalid credentials");
    if (!(await this.limiter.consume(loginName, input.trustedClientKey)))
      throw new Error("Invalid credentials");
    const credential = await this.credentials.find(loginName);
    const validPassword = await this.passwords.verify(
      input.password,
      credential?.passwordHash ?? this.dummyHash,
    );
    if (!credential || !credential.active || !validPassword)
      throw new Error("Invalid credentials");
    const deviceAssertionId = await this.devices.verify(
      credential.accountId,
      loginName,
      input.deviceId,
      input.trustedOrigin,
      input.deviceProof,
    );
    if (!deviceAssertionId) throw new Error("Invalid credentials");
    // Until privileged-role policy is implemented, require MFA for every account.
    if (!(await this.mfa.verify(credential.accountId, input.otp)))
      throw new Error("Invalid credentials");
    // Until device policy is implemented, allow only approved account-bound devices.
    try {
      return await this.issuer.issue(
        {
          accountId: credential.accountId,
          deviceId: input.deviceId,
          deviceRequired: true,
          deviceAssertionId,
        },
        this.lifetime,
      );
    } catch (error) {
      if (error instanceof SessionIssuanceDeniedError)
        throw new Error("Invalid credentials", { cause: error });
      throw error;
    }
  }
}
