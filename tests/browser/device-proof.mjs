import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  createServer as httpServer,
  request as httpRequest,
  get as httpGet,
} from "node:http";
import { createServer as httpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

// This smoke test exercises browser storage and UI. HTTP adapters are synthetic;
// the separate NestJS/PostgreSQL integration suite verifies authoritative access.
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const geographyId = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9";
const csrfToken = `${"B".repeat(43)}.${"C".repeat(43)}`;
const secret = randomBytes(32);
const scratch = await mkdtemp(join(tmpdir(), "agri-device-browser-"));
let proxy;
let app;
let context;
let initialPublicKey;
let adapter;
let loginCount = 0;
let registrationCount = 0;
const mutationRecords = new Map();
let releaseFirstRegistration;
const firstRegistrationGate = new Promise((resolve) => {
  releaseFirstRegistration = resolve;
});
async function freePort() {
  const server = httpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function ready(port) {
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise((resolve) => {
      const request = httpGet(`http://127.0.0.1:${port}/`, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.setTimeout(1000, () => request.destroy());
      request.on("error", () => resolve(false));
    });
    if (ok) return;
    if (app.exitCode !== null)
      throw new Error("Field production server exited before readiness");
    await delay(100);
  }
  throw new Error("Field production server did not become ready");
}
async function grantDurableStorage(browserContext, origin) {
  // Persistent profiles use the default context: omit the target context ID.
  // Chromium permission overrides belong to the CDP session. Keep this fixture
  // target/session alive until its browser context closes; no app API is mocked.
  const page = await browserContext.newPage();
  const session = await browserContext.newCDPSession(page);
  await session.send("Browser.grantPermissions", {
    origin,
    permissions: ["durableStorage"],
  });
}
async function setConnectivity(browserContext, page, offline) {
  await browserContext.setOffline(offline);
  // Chromium now separates transport emulation from navigator.onLine. Exercise
  // both native protocol surfaces; do not replace browser/app JavaScript APIs.
  const session = await browserContext.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.overrideNetworkState", {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}
async function installAdapters(origin) {
  let signedIn = false;
  adapter = async (route) => {
    const request = route.request();
    const path = request.url().split("/api/pilot/")[1];
    const input = request.method() === "POST" ? request.postDataJSON() : null;
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
      });
    if (path === "auth/device-challenge") {
      assert.equal(input.deviceId, deviceId);
      const challenge = {
        nonce: randomBytes(32).toString("base64url"),
        expiresAt: Math.floor(Date.now() / 1000) + 120,
      };
      const text = JSON.stringify([
        "agri-device-login-v1",
        origin,
        input.loginName.trim(),
        deviceId,
        challenge.nonce,
        challenge.expiresAt,
      ]);
      return reply({
        ...challenge,
        mac: createHmac("sha256", secret).update(text).digest("base64url"),
      });
    }
    if (path === "auth/login") {
      assert.equal(input.loginName, "synthetic");
      assert.equal(input.password, "synthetic-browser-password");
      assert.equal(input.otp, "123456");
      const proof = input.deviceProof;
      const text = JSON.stringify([
        "agri-device-login-v1",
        origin,
        "synthetic",
        deviceId,
        proof.nonce,
        proof.expiresAt,
      ]);
      assert.equal(
        proof.mac,
        createHmac("sha256", secret).update(text).digest("base64url"),
      );
      assert.equal(
        verify(
          "sha256",
          Buffer.from(JSON.stringify([text, proof.mac])),
          {
            key: createPublicKey({ key: initialPublicKey, format: "jwk" }),
            dsaEncoding: "ieee-p1363",
          },
          Buffer.from(proof.signature, "base64url"),
        ),
        true,
      );
      loginCount++;
      signedIn = true;
      return reply({ signedIn: true });
    }
    if (path === "auth/csrf")
      return reply(
        signedIn
          ? { accountId, csrfToken, deviceId }
          : { error: "Authentication required" },
        signedIn ? 200 : 401,
      );
    if (path === "registration/context") {
      if (!signedIn) return reply({ error: "Authentication required" }, 401);
      const key = initialPublicKey;
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }),
        )
        .digest("hex");
      return reply({
        accountId,
        deviceId,
        deviceKeyFingerprint: fingerprint,
        verifiedAt: Date.now(),
        offlineUntil: Date.now() + 3600000,
        geographies: [{ id: geographyId, name: "Synthetic village" }],
      });
    }
    if (path === "registration/geographies")
      return reply([{ id: geographyId, name: "Synthetic village" }]);
    if (path === "farmers/register") {
      assert.equal(signedIn, true);
      assert.equal(request.headers()["x-csrf-token"], csrfToken);
      registrationCount++;
      const previous = mutationRecords.get(input.mutationId);
      if (previous) assert.deepEqual(input, previous);
      else {
        mutationRecords.set(input.mutationId, input);
        await firstRegistrationGate;
        return route.abort("failed");
      }
      return reply({
        status: "synced",
        farmerId: input.farmer.farmerId,
        replayed: true,
      });
    }
    if (path === "auth/logout") {
      signedIn = false;
      return reply({ loggedOut: true });
    }
    throw new Error("Unexpected synthetic browser request");
  };
}
async function prepare(page) {
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Approved device ID", { exact: true }).fill(deviceId);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Download device enrollment request" })
      .click(),
  ]);
  const value = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.deepEqual(Object.keys(value).sort(), [
    "deviceId",
    "fingerprint",
    "origin",
    "publicKey",
    "version",
  ]);
  assert.equal(value.publicKey.d, undefined);
  const key = value.publicKey;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }))
    .digest("hex");
  assert.equal(value.fingerprint, fingerprint);
  await page.getByText(fingerprint, { exact: true }).waitFor();
  const local = await page.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => {
      const open = window.indexedDB.open("agri-device-keys-v1");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const row = await new Promise((resolve, reject) => {
        const request = db.transaction("keys").objectStore("keys").get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      let blocked = false;
      try {
        await window.crypto.subtle.exportKey("jwk", row.privateKey);
      } catch {
        blocked = true;
      }
      return {
        extractable: row.privateKey.extractable,
        exportBlocked: blocked,
      };
    } finally {
      db.close();
    }
  }, deviceId);
  assert.deepEqual(local, { extractable: false, exportBlocked: true });
  return value.publicKey;
}
async function signIn(page) {
  await page.getByLabel("Account name", { exact: true }).fill("synthetic");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic-browser-password");
  await page.getByLabel("Authenticator code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Full name", { exact: true }).count(), 0);
}
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(scratch, "key.pem"),
      "-out",
      join(scratch, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const port = await freePort();
  app = spawn(
    process.execPath,
    [
      resolve("apps/field-pwa/node_modules/next/dist/bin/next"),
      "start",
      "-p",
      String(port),
    ],
    {
      cwd: resolve("apps/field-pwa"),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    },
  );
  await ready(port);
  proxy = httpsServer(
    {
      key: await readFile(join(scratch, "key.pem")),
      cert: await readFile(join(scratch, "cert.pem")),
    },
    async (incoming, outgoing) => {
      if (incoming.url.startsWith("/api/pilot/") && adapter) {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        try {
          await adapter({
            request: () => ({
              url: () => `https://${incoming.headers.host}${incoming.url}`,
              method: () => incoming.method,
              headers: () => incoming.headers,
              postDataJSON: () => JSON.parse(body),
            }),
            fulfill: ({ status, contentType, headers, body }) => {
              outgoing.writeHead(status, {
                ...headers,
                "content-type": contentType,
              });
              outgoing.end(body);
            },
            abort: () => {
              // Commit succeeded, then truncate an acknowledged HTTP response.
              // Receiving headers prevents Chromium's transparent transport retry.
              outgoing.writeHead(200, {
                "content-type": "application/json",
                "content-length": "1000",
              });
              outgoing.write('{"status":');
              return delay(25).then(() => outgoing.destroy());
            },
          });
        } catch (error) {
          console.error("Synthetic adapter failed:", error);
          outgoing.destroy();
        }
        return;
      }
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: incoming.url,
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("error", () => {
        outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    },
  );
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const origin = `https://127.0.0.1:${proxy.address().port}`;
  const options = {
    headless: true,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    acceptDownloads: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
  };
  context = await chromium.launchPersistentContext(
    join(scratch, "profile"),
    options,
  );
  await installAdapters(origin);
  let page = await context.newPage();
  await page.goto(origin);
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  initialPublicKey = await prepare(page);
  await signIn(page);
  await context.close();
  context = null;
  // A second browser process reopens the same on-disk profile and signs with the same key.
  context = await chromium.launchPersistentContext(
    join(scratch, "profile"),
    options,
  );
  await installAdapters(origin);
  page = await context.newPage();
  await page.goto(origin);
  assert.deepEqual(await prepare(page), initialPublicKey);
  await signIn(page);
  assert.equal(loginCount, 2);
  assert.equal(registrationCount, 0);
  await context.close();
  context = null;
  const offlineOptions = {
    ...options,
    serviceWorkers: "allow",
    args: [
      ...options.args,
      "--ignore-certificate-errors",
      "--allow-insecure-localhost",
    ],
  };
  context = await chromium.launchPersistentContext(
    join(scratch, "profile"),
    offlineOptions,
  );
  await grantDurableStorage(context, origin);
  await installAdapters(origin);
  page = await context.newPage();
  await page.goto(origin);
  assert.deepEqual(await prepare(page), initialPublicKey);
  await signIn(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.goto(`${origin}/offline-workspace`);
  await page
    .getByLabel("Offline passphrase", { exact: true })
    .fill("synthetic-offline-browser-passphrase");
  await page
    .getByRole("button", { name: "Set up or unlock", exact: true })
    .click();
  await page.waitForFunction(() => {
    const input = document.getElementById("farmer-full-name");
    return input && !input.disabled;
  });
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Synthetic partial offline");
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Device storage"]')?.textContent ===
      "Saved on Device",
  );
  await context.close();
  context = null;
  // Restart offline: the public shell and encrypted working draft must survive without adapters/network.
  context = await chromium.launchPersistentContext(
    join(scratch, "profile"),
    offlineOptions,
  );
  await grantDurableStorage(context, origin);
  page = await context.newPage();
  await page.clock.install();
  await setConnectivity(context, page, true);
  await page.goto(`${origin}/offline-workspace`);
  await setConnectivity(context, page, true);
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  await page
    .getByLabel("Offline passphrase", { exact: true })
    .fill("synthetic-offline-browser-passphrase");
  await page
    .getByRole("button", { name: "Set up or unlock", exact: true })
    .click();
  await page.getByLabel("Full name", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Full name", { exact: true }).inputValue(),
    "Synthetic partial offline",
  );
  assert.equal(
    await page.getByLabel("I provided the required privacy notice").isChecked(),
    false,
  );
  await page.clock.fastForward(300001);
  await page.getByText("Workspace locked", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Full name", { exact: true }).count(), 0);
  await page
    .getByLabel("Offline passphrase", { exact: true })
    .fill("synthetic-offline-browser-passphrase");
  await page
    .getByRole("button", { name: "Set up or unlock", exact: true })
    .click();
  await page.getByLabel("Full name", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Full name", { exact: true }).inputValue(),
    "Synthetic partial offline",
  );
  await page
    .getByLabel("GN division or village", { exact: true })
    .selectOption(geographyId);
  await page.getByLabel("I provided the required privacy notice").check();
  await page
    .getByRole("button", { name: "Save registration", exact: true })
    .click();
  await page.waitForFunction(() => {
    const input = document.getElementById("farmer-full-name");
    return input && input.value === "";
  });
  await page.getByText("Synthetic partial offline", { exact: true }).waitFor();
  const cachesSafe = await page.evaluate(async () => {
    for (const name of await window.caches.keys()) {
      const cache = await window.caches.open(name);
      for (const key of await cache.keys()) {
        if (new window.URL(key.url).pathname.startsWith("/api/")) return false;
        const response = await cache.match(key);
        if ((await response.text()).includes("Synthetic partial offline"))
          return false;
      }
    }
    return true;
  });
  assert.equal(cachesSafe, true);
  await page.clock.setSystemTime(Date.now());
  await installAdapters(origin);
  await setConnectivity(context, page, false);
  await page.getByText("Workspace locked", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("Synthetic partial offline", { exact: true }).count(),
    0,
  );
  await page.goto(origin);
  assert.deepEqual(await prepare(page), initialPublicKey);
  await signIn(page);
  await page.goto(`${origin}/offline-workspace`);
  await page
    .getByLabel("Offline passphrase", { exact: true })
    .fill("synthetic-offline-browser-passphrase");
  await page
    .getByRole("button", { name: "Set up or unlock", exact: true })
    .click();
  await page.getByText("Syncing…", { exact: true }).waitFor();
  assert.equal(await page.getByText("Synced", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "සිංහල", exact: true }).click();
  await page.getByText("සමමුහුර්ත කරමින්…", { exact: true }).waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  releaseFirstRegistration();
  await page.getByText("Pending Sync", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Sync Now", exact: true }).click();
  await page.getByText("Synced", { exact: true }).waitFor();
  assert.equal(mutationRecords.size, 1);
  assert.equal(registrationCount, 2);
  await page
    .getByRole("button", { name: "Remove synced local copy", exact: true })
    .click();
  await page.getByText("No saved registrations.", { exact: true }).waitFor();
  // Preserve an incomplete draft alongside the confirmed submission, then recover
  // after simulated loss of this synthetic vault (the device-key store survives).
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Synthetic archive unfinished");
  await page
    .getByRole("status", { name: "Device storage", exact: true })
    .filter({ hasText: "Saved on Device" })
    .waitFor();
  const [archiveDownload] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export encrypted archive", exact: true })
      .click(),
  ]);
  const archivePath = join(scratch, "authenticated-recovery.json");
  await archiveDownload.saveAs(archivePath);
  const archived = JSON.parse(await readFile(archivePath, "utf8"));
  assert.equal(archived.version, 2);
  assert.equal(
    JSON.stringify(archived).includes("Synthetic archive unfinished"),
    false,
  );
  await page
    .getByRole("button", { name: "Lock workspace", exact: true })
    .click();
  await page.goto(origin);
  await page.evaluate(
    async ({ accountId, deviceId }) => {
      await new Promise((resolve, reject) => {
        const request = window.indexedDB.deleteDatabase(
          `agri-registration-v1-${accountId}-${deviceId}`,
        );
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error("Synthetic vault still open"));
      });
    },
    { accountId, deviceId },
  );
  await page.goto(`${origin}/offline-workspace`);
  await page
    .getByLabel("Offline passphrase", { exact: true })
    .fill("synthetic-new-recovery-passphrase");
  await page
    .getByRole("button", { name: "Set up or unlock", exact: true })
    .click();
  await page.getByLabel("Full name", { exact: true }).waitFor();
  await page
    .getByText("Restore an authenticated archive", { exact: true })
    .click();
  await page
    .getByLabel("Encrypted archive file (version 2)", { exact: true })
    .setInputFiles(archivePath);
  await page
    .getByLabel("Original archive passphrase", { exact: true })
    .fill("synthetic-offline-browser-passphrase");
  await page
    .getByLabel(
      "I kept the original archive and want to restore into this empty vault.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Restore archive", exact: true })
    .click();
  await page
    .getByText(
      "Archive restored. Review recovered drafts and use Sync Now for completed submissions.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Original archive passphrase", { exact: true })
      .inputValue(),
    "",
  );
  await page
    .getByRole("button", { name: "Continue this draft", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.getElementById("farmer-full-name")?.value ===
      "Synthetic archive unfinished",
  );
  assert.equal(
    await page.getByLabel("Full name", { exact: true }).inputValue(),
    "Synthetic archive unfinished",
  );
  assert.equal(
    await page
      .getByLabel("GN division or village", { exact: true })
      .inputValue(),
    "",
  );
  assert.equal(
    await page.getByLabel("I provided the required privacy notice").isChecked(),
    false,
  );
  assert.equal(mutationRecords.size, 1);
  console.log(
    "Chromium passed: secure-context key preparation, non-exportability, browser restart persistence, signed login, offline process restart/draft recovery, reauthentication, visible bilingual sync progress, safe sync retry, local cleanup, authenticated archive recovery and no private HTTP caching.",
  );
} catch (error) {
  const diagnostic = context?.pages().at(-1);
  if (diagnostic)
    console.error(
      "Synthetic browser diagnostic:",
      (
        await diagnostic
          .locator("body")
          .innerText()
          .catch(() => "unavailable")
      ).slice(0, 4000),
    );
  throw error;
} finally {
  if (context) await context.close();
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  if (app && app.exitCode === null) {
    app.kill("SIGTERM");
    await new Promise((resolve) => app.once("exit", resolve));
  }
  await rm(scratch, { recursive: true, force: true });
}
