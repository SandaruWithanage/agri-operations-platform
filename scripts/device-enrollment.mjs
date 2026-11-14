import { Buffer } from "node:buffer";
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import pg from "pg";
export class DeviceEnrollmentError extends Error {}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateEnrollment(input, origin, fingerprint) {
  const allowed = ["version", "deviceId", "origin", "publicKey", "fingerprint"];
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).length !== allowed.length ||
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    input.version !== 1 ||
    !uuid.test(input.deviceId) ||
    typeof origin !== "string" ||
    input.origin !== origin
  )
    throw new DeviceEnrollmentError("Invalid public enrollment request");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin)
    throw new DeviceEnrollmentError(
      "Enrollment requires the expected HTTPS origin",
    );
  const key = input.publicKey;
  if (
    !key ||
    typeof key !== "object" ||
    Object.keys(key).sort().join(",") !== "crv,kty,x,y" ||
    key.kty !== "EC" ||
    key.crv !== "P-256" ||
    [key.x, key.y].some(
      (value) =>
        typeof value !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(value) ||
        Buffer.from(value, "base64url").toString("base64url") !== value,
    )
  )
    throw new DeviceEnrollmentError("Only a public P-256 key is accepted");
  try {
    createPublicKey({ key, format: "jwk" });
  } catch {
    throw new DeviceEnrollmentError("Invalid public key coordinates");
  }
  const actual = createHash("sha256")
    .update(JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }))
    .digest("hex");
  if (fingerprint !== actual || input.fingerprint !== actual)
    throw new DeviceEnrollmentError(
      "Independently verified fingerprint does not match",
    );
  return { deviceId: input.deviceId.toLowerCase(), publicKey: key };
}
/** Dedicated provisioning connection; not callable by any API runtime identity. */
export async function enrollDevice(
  client,
  input,
  { accountId, origin, fingerprint },
) {
  if (!uuid.test(accountId))
    throw new DeviceEnrollmentError("Invalid target account");
  const request = validateEnrollment(input, origin, fingerprint);
  await client.query("BEGIN");
  try {
    const device = await client.query(
      "SELECT d.id FROM authn.device d JOIN authn.account a ON a.id=d.account_id WHERE d.id=$1 AND d.account_id=$2 AND d.state='approved' AND d.revoked_at IS NULL AND a.active=true FOR UPDATE OF d",
      [request.deviceId, accountId],
    );
    if (!device.rowCount)
      throw new DeviceEnrollmentError(
        "An approved device bound to the active target account is required",
      );
    const existing = await client.query(
      "SELECT public_jwk,revoked_at FROM authn.device_key WHERE device_id=$1 AND account_id=$2",
      [request.deviceId, accountId],
    );
    let result = "enrolled";
    if (existing.rowCount) {
      const old = existing.rows[0];
      if (
        old.revoked_at ||
        ["kty", "crv", "x", "y"].some(
          (key) => old.public_jwk[key] !== request.publicKey[key],
        )
      )
        throw new DeviceEnrollmentError(
          "Existing key cannot be replaced; provision a new device record",
        );
      result = "already-enrolled";
    } else
      await client.query(
        "INSERT INTO authn.device_key(id,device_id,account_id,public_jwk) VALUES($1,$2,$3,$4)",
        [randomUUID(), request.deviceId, accountId, request.publicKey],
      );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
export async function revokeDevice(client, { accountId, deviceId }) {
  if (!uuid.test(accountId) || !uuid.test(deviceId))
    throw new DeviceEnrollmentError("Invalid account/device identifier");
  await client.query("BEGIN");
  try {
    const found = await client.query(
      "SELECT id,revoked_at FROM authn.device_key WHERE device_id=$1 AND account_id=$2 FOR UPDATE",
      [deviceId, accountId],
    );
    if (!found.rowCount)
      throw new DeviceEnrollmentError(
        "Device key not found for the target account",
      );
    const result = found.rows[0].revoked_at ? "already-revoked" : "revoked";
    if (result === "revoked")
      await client.query(
        "UPDATE authn.device_key SET revoked_at=clock_timestamp() WHERE id=$1",
        [found.rows[0].id],
      );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
export async function assertProvisioner(client) {
  const result = await client.query(
    "SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,pg_has_role(current_user,'agri_device_provisioner','USAGE') AS permitted,has_column_privilege(current_user,'authn.account','password_hash','SELECT') AS password_access,has_column_privilege(current_user,'authn.login_session','cookie_secret_hash','SELECT') AS session_access,has_any_column_privilege(current_user,'authn.login_session','INSERT,UPDATE') OR has_table_privilege(current_user,'authn.login_session','DELETE,TRUNCATE') AS session_write FROM pg_roles r WHERE rolname=current_user",
  );
  const row = result.rows[0];
  if (
    !row ||
    row.rolsuper ||
    row.rolbypassrls ||
    row.rolcreaterole ||
    row.rolcreatedb ||
    !row.permitted ||
    row.password_access ||
    row.session_access ||
    row.session_write
  )
    throw new DeviceEnrollmentError(
      "Provisioning requires the dedicated least-privilege operator identity",
    );
  const forbidden = [
    "agri_authn_function_owner",
    "agri_policy_owner",
    "agri_credential_reader",
    "agri_mfa_verifier",
    "agri_login_throttle",
    "agri_session_issuer",
    "agri_session_executor",
    "agri_session_reader",
    "agri_farmer_runtime",
    "agri_device_verifier",
  ];
  for (const role of forbidden)
    if (
      (
        await client.query(
          "SELECT pg_has_role(current_user,$1,'MEMBER') AS member",
          [role],
        )
      ).rows[0].member
    )
      throw new DeviceEnrollmentError(
        "Operator and runtime/owner role memberships must be separate",
      );
}
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!["enroll", "revoke"].includes(mode) || args.length % 2)
    throw new DeviceEnrollmentError(
      "Use enroll --account UUID --request FILE --origin HTTPS_ORIGIN --fingerprint SHA256_HEX or revoke --account UUID --device UUID",
    );
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (options.has(args[i]))
      throw new DeviceEnrollmentError("Duplicate option");
    options.set(args[i], args[i + 1]);
  }
  const expected =
    mode === "enroll"
      ? ["--account", "--request", "--origin", "--fingerprint"]
      : ["--account", "--device"];
  if (
    options.size !== expected.length ||
    expected.some((name) => !options.get(name))
  )
    throw new DeviceEnrollmentError("Missing or unexpected operator option");
  let input;
  if (mode === "enroll") {
    const raw = await readFile(options.get("--request"));
    if (raw.length > 16384)
      throw new DeviceEnrollmentError("Enrollment request is too large");
    input = JSON.parse(raw.toString("utf8"));
    validateEnrollment(
      input,
      options.get("--origin"),
      options.get("--fingerprint"),
    );
  }
  const raw = process.env.DEVICE_PROVISION_DATABASE_URL;
  const database = process.env.DEVICE_PROVISION_DATABASE_NAME;
  if (!raw || !database)
    throw new DeviceEnrollmentError(
      "Set the separate provisioning connection and expected database through the secret environment",
    );
  const url = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.pathname.slice(1)) !== database ||
    (process.env.NODE_ENV === "production" &&
      url.searchParams.get("sslmode") !== "verify-full")
  )
    throw new DeviceEnrollmentError(
      "Invalid provisioning target or TLS configuration",
    );
  const client = new pg.Client({
    connectionString: raw,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    application_name: "agri-device-provisioning",
  });
  try {
    await client.connect();
    await assertProvisioner(client);
    const result =
      mode === "enroll"
        ? await enrollDevice(client, input, {
            accountId: options.get("--account"),
            origin: options.get("--origin"),
            fingerprint: options.get("--fingerprint"),
          })
        : await revokeDevice(client, {
            accountId: options.get("--account"),
            deviceId: options.get("--device"),
          });
    console.log(result);
  } finally {
    await client.end();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(
      error instanceof DeviceEnrollmentError
        ? error.message
        : "Device provisioning failed; sensitive database/SQL details were suppressed.",
    );
    process.exitCode = 1;
  });
