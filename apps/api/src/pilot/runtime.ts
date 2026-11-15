import { RuntimeReadiness } from "./readiness";
import { LandIdentificationService } from "../land/identification-service";
import { FarmerHistoryService } from "../farmer/history-service";
import { FarmerChangeService } from "../farmer/change-service";
import { FarmerRegistryService } from "../farmer/registry-service";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { createPrivateKey, createPublicKey } from "node:crypto";
import {
  createLocalJWKSet,
  exportJWK,
  importPKCS8,
  importSPKI,
  SignJWT,
} from "jose";
import pg from "pg";
import { z } from "zod";
import { DeviceProofs } from "../authentication/device-proof";
import { LoginCoordinator } from "../authentication/login-coordinator";
import { verifyPassword } from "../authentication/passwords";
import { PostgresCredentialReader } from "../authentication/postgres-credential-reader";
import { PostgresMfaVerifier } from "../authentication/postgres-mfa-verifier";
import { PostgresLoginLimiter } from "../authentication/postgres-login-limiter";
import { PostgresSessionIssuer } from "../authentication/postgres-session-issuer";
import { PostgresSessionOperations } from "../authentication/postgres-session-operations";
import { PostgresSessionReader } from "../authentication/postgres-session-reader";
import { SessionAccess } from "../authentication/session-access";
import { AccessTokenVerifier } from "../authentication/access-token-verifier";
import { CsrfTokens } from "../authentication/csrf";
import { FarmerRegistrationService } from "../farmer/registration-service";
import { TransactionActorContext } from "../authorization/transaction-context";
import type { PilotRuntime } from "./contracts";

const roles = [
  "agri_credential_reader",
  "agri_mfa_verifier",
  "agri_login_throttle",
  "agri_session_issuer",
  "agri_session_executor",
  "agri_session_reader",
  "agri_farmer_runtime",
  "agri_device_verifier",
  "agri_land_runtime",
] as const;
const configSchema = z.object({
  PILOT_INTERNAL_KEY: z.string().min(43).max(200),
  PILOT_DATABASE_URLS: z.string(),
  PILOT_MFA_KEYS: z.string(),
  PILOT_THROTTLE_KEY: z.string(),
  PILOT_CSRF_KEY: z.string(),
  PILOT_ACTOR_KEY: z.string(),
  PILOT_DEVICE_CHALLENGE_KEY: z.string(),
  PILOT_JWT_PRIVATE_KEY: z.string(),
  PILOT_JWT_KID: z.string().min(1).max(100),
  PILOT_JWT_ISSUER: z.string().min(1),
  PILOT_JWT_AUDIENCE: z.string().min(1),
  PILOT_ORIGINS: z.string(),
  PILOT_OFFLINE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86400)
    .default(3600),
  PILOT_JWT_SECONDS: z.coerce.number().int().min(300).max(600).default(300),
  PILOT_IDLE_SECONDS: z.coerce.number().int().min(60).max(86400).default(1800),
  PILOT_ABSOLUTE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(2592000)
    .default(28800),
});
function key(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value)
    throw new Error("Pilot key must be canonical base64 for 32 bytes");
  return decoded;
}

/** Disabled by default. Misconfiguration fails startup rather than falling back to privileged connections. */
export async function createPilotRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PilotRuntime | null> {
  if (env.ENABLE_PILOT_AUTH !== "true") return null;
  const parsed = configSchema.safeParse(env);
  if (!parsed.success)
    throw new Error("Pilot authentication configuration is incomplete");
  const c = parsed.data;
  if (c.PILOT_IDLE_SECONDS > c.PILOT_ABSOLUTE_SECONDS)
    throw new Error("Invalid session expiration configuration");
  let urls: Record<string, string>;
  let mfaKeys: Record<string, string>;
  try {
    urls = z.record(z.string().url()).parse(JSON.parse(c.PILOT_DATABASE_URLS));
    mfaKeys = z.record(z.string()).parse(JSON.parse(c.PILOT_MFA_KEYS));
  } catch {
    throw new Error("Invalid pilot database or key mapping");
  }
  const decodedKeys = new Map(
    Object.entries(mfaKeys).map(([id, value]) => [id, key(value)]),
  );
  if (!decodedKeys.size) throw new Error("MFA key configuration is empty");
  const csrf = new CsrfTokens(
    key(c.PILOT_CSRF_KEY),
    c.PILOT_ORIGINS.split(","),
  );
  const privateObject = createPrivateKey(c.PILOT_JWT_PRIVATE_KEY);
  if (
    privateObject.asymmetricKeyType !== "rsa" ||
    (privateObject.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw new Error("JWT signing requires RSA with at least 2048 bits");
  const privateKey = await importPKCS8(c.PILOT_JWT_PRIVATE_KEY, "RS256");
  const publicKey = await importSPKI(
    createPublicKey(privateObject)
      .export({ type: "spki", format: "pem" })
      .toString(),
    "RS256",
  );
  const jwk = await exportJWK(publicKey);
  jwk.kid = c.PILOT_JWT_KID;
  jwk.alg = "RS256";
  const verifier = new AccessTokenVerifier(
    {
      issuer: c.PILOT_JWT_ISSUER,
      audience: c.PILOT_JWT_AUDIENCE,
      maxLifetimeSeconds: c.PILOT_JWT_SECONDS,
    },
    createLocalJWKSet({ keys: [jwk] }),
  );
  const pools = new Map<string, pg.Pool>();
  try {
    for (const role of roles) {
      const raw = urls[role];
      if (!raw)
        throw new Error("A required pilot database connection is missing");
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new Error("Invalid pilot database URL");
      }
      if (!["postgres:", "postgresql:"].includes(url.protocol))
        throw new Error("Invalid database protocol");
      if (
        env.NODE_ENV === "production" &&
        url.searchParams.get("sslmode") !== "verify-full"
      )
        throw new Error("Production database connections require verified TLS");
      const pool = new pg.Pool({
        connectionString: raw,
        max: 2,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
      });
      pool.on("error", () =>
        console.error("Pilot database idle connection error"),
      );
      pools.set(role, pool);
      const check = await pool.query(
        "SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,pg_has_role(current_user,'agri_authn_function_owner','MEMBER') OR pg_has_role(current_user,'agri_policy_owner','MEMBER') OR pg_has_role(current_user,'agri_land_function_owner','MEMBER') OR pg_has_role(current_user,'agri_device_provisioner','MEMBER') AS owner_member,has_function_privilege(current_user,(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='authn' AND p.proname='issue_session' AND p.pronargs=8),'EXECUTE') AS legacy_issue,(SELECT has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='authn' AND c.relname='login_session') AS direct_session_write,EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('farm','land') AND c.relname IN ('farmer_audit','farmer_change','registration_mutation','registration_risk','audit') AND (has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER'))) AS journal_access,pg_has_role(current_user,$1,'USAGE') AS permitted,has_any_column_privilege(current_user,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='authz' AND c.relname='context_key'),'SELECT') AS key_access FROM pg_roles r WHERE r.rolname=current_user",
        [role],
      );
      const row = check.rows[0];
      if (
        !row ||
        row.rolsuper ||
        row.rolbypassrls ||
        row.rolcreaterole ||
        row.rolcreatedb ||
        row.owner_member ||
        row.legacy_issue !== false ||
        row.direct_session_write !== false ||
        row.journal_access !== false ||
        !row.permitted ||
        row.key_access !== false
      )
        throw new Error("Pilot database role violates least privilege");
      for (const other of roles) {
        if (
          other !== role &&
          (
            await pool.query(
              "SELECT pg_has_role(current_user,$1,'MEMBER') AS member",
              [other],
            )
          ).rows[0].member
        )
          throw new Error("Pilot database roles must be separated");
      }
    }
    const pool = (role: string) => pools.get(role)!;
    const operations = new PostgresSessionOperations(
      pool("agri_session_executor"),
    );
    const sessions = new SessionAccess(
      verifier,
      new PostgresSessionReader(pool("agri_session_reader")),
    );
    const devices = new DeviceProofs(
      pool("agri_device_verifier"),
      key(c.PILOT_DEVICE_CHALLENGE_KEY),
      c.PILOT_ORIGINS.split(","),
    );
    const coordinator = await LoginCoordinator.create(
      new PostgresCredentialReader(pool("agri_credential_reader")),
      { verify: verifyPassword },
      new PostgresMfaVerifier(pool("agri_mfa_verifier"), {
        getKey: async (id) => {
          const value = decodedKeys.get(id);
          if (!value) throw new Error("MFA key unavailable");
          return value;
        },
      }),
      new PostgresLoginLimiter(
        pool("agri_login_throttle"),
        key(c.PILOT_THROTTLE_KEY),
        { limit: 5, windowSeconds: 900, blockSeconds: 900 },
      ),
      new PostgresSessionIssuer({
        executeCommitted: (sql, args) =>
          pool("agri_session_issuer").query(sql, args),
      }),
      {
        idleSeconds: c.PILOT_IDLE_SECONDS,
        absoluteSeconds: c.PILOT_ABSOLUTE_SECONDS,
      },
      devices,
    );
    const context = new TransactionActorContext(key(c.PILOT_ACTOR_KEY));
    const registration = new FarmerRegistrationService(context);
    const use = async (secret: string) => {
      const session = await operations.use(secret, c.PILOT_IDLE_SECONDS);
      if (!session) throw new UnauthorizedException();
      return session;
    };
    const deviceFor = async (actor: {
      sessionId: string;
      accountId: string;
    }) => {
      const result = await pool("agri_session_reader").query(
        "SELECT device_id FROM authn.login_session WHERE id=$1 AND account_id=$2",
        [actor.sessionId, actor.accountId],
      );
      const deviceId = result.rows[0]?.device_id;
      if (typeof deviceId !== "string") throw new UnauthorizedException();
      return deviceId;
    };
    const history = new FarmerHistoryService(context);
    const registry = new FarmerRegistryService(context);
    const land = new LandIdentificationService(context);
    const changes = new FarmerChangeService(context);
    const readiness = new RuntimeReadiness(
      Array.from(pools.values(), (database) => async () => {
        // pg supports per-query timeouts; @types/pg exposes this only on clients.
        const probe: pg.QueryConfig & { query_timeout: number } = {
          text: "SELECT NOT pg_is_in_recovery() AND current_setting('transaction_read_only')='off' AS ready",
          query_timeout: 1500,
        };
        const result = await database.query(probe);
        return result.rows[0]?.ready === true;
      }),
    );
    return {
      readiness: () => readiness.check(),
      internalKey: c.PILOT_INTERNAL_KEY,
      deviceChallenge: (input, origin) =>
        devices.issue(input.loginName, input.deviceId, origin),
      login: async (input, clientKey, origin) =>
        coordinator.login({
          ...input,
          trustedClientKey: clientKey,
          trustedOrigin: origin,
        }),
      csrf: async (secret) => {
        const session = await use(secret);
        return {
          csrfToken: csrf.issue(session.sessionId),
          accountId: session.accountId,
          deviceId: await deviceFor(session),
        };
      },
      token: async (secret) => {
        const session = await use(secret);
        return {
          accessToken: await new SignJWT({ sid: session.sessionId })
            .setProtectedHeader({
              alg: "RS256",
              kid: c.PILOT_JWT_KID,
              typ: "at+jwt",
            })
            .setIssuer(c.PILOT_JWT_ISSUER)
            .setAudience(c.PILOT_JWT_AUDIENCE)
            .setSubject(session.accountId)
            .setIssuedAt()
            .setExpirationTime(`${c.PILOT_JWT_SECONDS}s`)
            .sign(privateKey),
        };
      },
      logout: async (secret, origin, token) => {
        const session = await use(secret);
        try {
          csrf.assertValid(session.sessionId, origin, token);
        } catch {
          throw new ForbiddenException("CSRF validation failed");
        }
        await operations.logout(secret);
      },
      authenticate: async (token) => {
        try {
          return await sessions.authenticate(token);
        } catch {
          throw new UnauthorizedException();
        }
      },
      assertCsrf: (actor, origin, token) => {
        try {
          csrf.assertValid(actor.sessionId, origin, token);
        } catch {
          throw new ForbiddenException("CSRF validation failed");
        }
      },
      register: async (actor, source, input) => {
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await registration.register(connection, actor, source, input);
        } finally {
          connection.release();
        }
      },
      geographies: async (actor, source) => {
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await context.run(
            connection,
            actor,
            async (db) =>
              (
                await db.query(
                  "SELECT * FROM farm.registration_geographies($1)",
                  [source],
                )
              ).rows as Array<{ id: string; name: string }>,
          );
        } finally {
          connection.release();
        }
      },
      context: async (actor, source) => {
        const deviceId = await deviceFor(actor);
        const deviceKeyFingerprint = await devices.fingerprint(
          actor.accountId,
          deviceId,
        );
        if (!deviceKeyFingerprint) throw new UnauthorizedException();
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await context.run(connection, actor, async (db) => {
            const check = await db.query("SELECT authz.actor() AS actor", []);
            if (
              (check.rows[0] as { actor?: unknown } | undefined)?.actor !==
              actor.accountId
            )
              throw new ForbiddenException();
            const geographies = (
              await db.query(
                "SELECT * FROM farm.registration_geographies($1)",
                [source],
              )
            ).rows as Array<{ id: string; name: string }>;
            const verifiedAt = Date.now();
            return {
              accountId: actor.accountId,
              deviceId,
              deviceKeyFingerprint,
              verifiedAt,
              offlineUntil: verifiedAt + c.PILOT_OFFLINE_SECONDS * 1000,
              geographies,
            };
          });
        } finally {
          connection.release();
        }
      },
      changeFarmer: async (actor, input) => {
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await changes.change(connection, actor, input);
        } finally {
          connection.release();
        }
      },
      farmerCorrectionGeographies: async (actor, input) => {
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await changes.correctionGeographies(connection, actor, input);
        } finally {
          connection.release();
        }
      },
      farmerVerificationReceipt: async (actor, input) => {
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await changes.verificationReceipt(connection, actor, input);
        } finally {
          connection.release();
        }
      },
      farmerCorrectionReceipt: async (actor, input) => {
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await changes.correctionReceipt(connection, actor, input);
        } finally {
          connection.release();
        }
      },
      farmerHistory: async (actor, input) => {
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await history.history(connection, actor, input);
        } finally {
          connection.release();
        }
      },
      registerLand: async (actor, source, input) => {
        const connection = await pool("agri_land_runtime").connect();
        try {
          return await land.register(connection, actor, source, input);
        } finally {
          connection.release();
        }
      },
      listLand: async (actor, input) => {
        const connection = await pool("agri_land_runtime").connect();
        try {
          return await land.list(connection, actor, input);
        } finally {
          connection.release();
        }
      },
      landDetail: async (actor, input) => {
        const connection = await pool("agri_land_runtime").connect();
        try {
          return await land.detail(connection, actor, input);
        } finally {
          connection.release();
        }
      },
      landGeographies: async (actor, source) => {
        const connection = await pool("agri_land_runtime").connect();
        try {
          return await land.geographies(connection, actor, source);
        } finally {
          connection.release();
        }
      },
      listFarmers: async (actor, input) => {
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await registry.list(connection, actor, input);
        } finally {
          connection.release();
        }
      },
      farmerDetail: async (actor, input) => {
        const connection = await pool("agri_farmer_runtime").connect();
        try {
          return await registry.detail(connection, actor, input);
        } finally {
          connection.release();
        }
      },
      close: async () => {
        readiness.stop();
        await Promise.all([...pools.values()].map((pool) => pool.end()));
      },
    };
  } catch (error) {
    await Promise.all([...pools.values()].map((pool) => pool.end()));
    throw error;
  }
}
