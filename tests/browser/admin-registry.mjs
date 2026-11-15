import { URL } from "node:url";
import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const ids = [
  "06149451-4004-4a23-a5a2-64a24e485a82",
  "1d1ebede-c4a3-4d34-a6f5-5962cc403d0b",
  "26710056-4b42-4558-a47f-1f533dd50a97",
];
const rows = ids.map((id, index) => ({
  id,
  fullName: `Synthetic admin farmer ${index + 1}`,
  geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  geographyName: "Synthetic authorized village",
  status: "pending-review",
  createdAt: "2026-11-15T10:00:00.000Z",
  version: 1,
  duplicateRisk: false,
  nic: "synthetic-sensitive-extra",
}));
const children = [];
let browser;
async function port() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}
async function ready(url, child) {
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise((done) => {
      const req = get(url, (response) => {
        response.resume();
        done(response.statusCode === 200);
      });
      req.setTimeout(1000, () => req.destroy());
      req.on("error", () => done(false));
    });
    if (ok) return;
    if (child.exitCode !== null)
      throw new Error("Synthetic browser fixture server exited");
    await delay(100);
  }
  throw new Error("Fixture readiness timeout");
}
try {
  // Start the compiled API too: shared validation must load correctly in its CJS runtime.
  const apiPort = await port();
  const api = spawn(process.execPath, [resolve("apps/api/dist/main.js")], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      API_PORT: String(apiPort),
      ENABLE_PILOT_AUTH: "false",
    },
    stdio: "ignore",
  });
  children.push(api);
  await ready(`http://127.0.0.1:${apiPort}/health`, api);
  assert.equal(
    (await globalThis.fetch(`http://127.0.0.1:${apiPort}/health`)).status,
    200,
  );
  assert.equal(
    (await globalThis.fetch(`http://127.0.0.1:${apiPort}/pilot/farmers`))
      .status,
    503,
  );
  const adminPort = await port();
  const app = spawn(
    process.execPath,
    [
      resolve("apps/admin-web/node_modules/next/dist/bin/next"),
      "start",
      "-p",
      String(adminPort),
    ],
    {
      cwd: resolve("apps/admin-web"),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    },
  );
  children.push(app);
  const origin = `http://127.0.0.1:${adminPort}`;
  await ready(origin, app);
  assert.equal(
    (await (await globalThis.fetch(origin)).text()).includes(rows[0].fullName),
    false,
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
  });
  const context = await browser.newContext();
  let authorized = true,
    readable = true;
  await context.route("**/api/pilot/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace("/api/pilot/", "");
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
      });
    if (!authorized) return reply({ error: "Authentication required" }, 401);
    if (path === "registration/context")
      return reply({
        accountId,
        deviceId,
        deviceKeyFingerprint: "a".repeat(64),
        verifiedAt: Date.now(),
        offlineUntil: Date.now() + 3600000,
        geographies: [],
      });
    if (path === "farmers")
      return reply({
        accountId,
        items: !readable
          ? []
          : url.searchParams.has("after")
            ? rows.slice(2)
            : rows.slice(0, 2),
        nextCursor: readable && !url.searchParams.has("after") ? ids[1] : null,
      });
    if (path === "farmers/detail")
      return reply({
        accountId,
        farmer: rows.find((row) => row.id === url.searchParams.get("id")),
      });
    throw new Error("Unexpected synthetic registry request");
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  assert.equal(
    await page.getByText(rows[2].fullName, { exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByText(rows[2].fullName, { exact: true }).waitFor();
  assert.equal(
    await page.getByText(rows[0].fullName, { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: `View record: ${rows[0].fullName}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: rows[0].fullName, exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close record", exact: true }).click();
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  await page.getByRole("button", { name: "සිංහල", exact: true }).click();
  await page.getByRole("heading", { name: "ගොවි ලේඛනය", exact: true }).waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  readable = false;
  await page
    .getByRole("button", { name: "Check session and refresh", exact: true })
    .click();
  await page
    .getByText(
      "No farmer records are available within your current read permissions.",
      { exact: true },
    )
    .waitFor();
  for (const row of rows)
    assert.equal(
      await page.getByText(row.fullName, { exact: true }).count(),
      0,
    );
  readable = true;
  await page
    .getByRole("button", { name: "Check session and refresh", exact: true })
    .click();
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  authorized = false;
  await page
    .getByRole("button", {
      name: `View record: ${rows[0].fullName}`,
      exact: true,
    })
    .click();
  await page.getByLabel("Password", { exact: true }).waitFor();
  for (const row of rows)
    assert.equal(
      await page.getByText(row.fullName, { exact: true }).count(),
      0,
    );
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.localStorage)),
    '{"agri-language":"en"}',
  );
  assert.equal(
    await page.evaluate(
      async () => (await window.indexedDB.databases()).length,
    ),
    0,
  );
  assert.equal(
    (await page.locator("body").innerText()).includes(
      "synthetic-sensitive-extra",
    ),
    false,
  );
  console.log(
    "Chromium passed: compiled API startup, admin pagination/detail, bilingual controls, scope/session rejection cleanup and no browser farmer persistence.",
  );
} finally {
  if (browser) await browser.close();
  for (const child of children.reverse())
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((done) => child.once("exit", done));
    }
}
