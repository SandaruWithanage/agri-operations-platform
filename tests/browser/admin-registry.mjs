import { URL } from "node:url";
import { createRequire } from "node:module";
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
  // Production uses CJS API code and ESM validation; invalid input must retain
  // the API's Zod error identity rather than becoming a generic 503.
  const apiRequire = createRequire(resolve("apps/api/package.json"));
  const compiledValidation = apiRequire("@agri/validation");
  assert.throws(
    () => compiledValidation.farmerChangeSchema.parse({}),
    apiRequire("zod").ZodError,
  );
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
  const disabledReadiness = await globalThis.fetch(
    `http://127.0.0.1:${apiPort}/ready`,
  );
  assert.equal(disabledReadiness.status, 503);
  assert.deepEqual(await disabledReadiness.json(), { status: "not-ready" });
  assert.equal(disabledReadiness.headers.get("cache-control"), "no-store");
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
  let correctionAllowed = true;
  let authorized = true,
    readable = true,
    auditable = true,
    landReadable = true,
    verifyAllowed = true,
    verificationCalls = 0,
    verificationReceipt = null;
  const landRows = ids.map((id, index) => ({
    id,
    label: `Synthetic browser land ${index + 1}`,
    geographyId: rows[0].geographyId,
    geographyName: rows[0].geographyName,
    point:
      index === 2 ? null : { longitude: 80.25, latitude: 8.3, accuracyM: 0 },
    reportedAreaHectares: index === 2 ? null : 0,
    createdAt: rows[0].createdAt,
    version: 1,
    identificationOnly: true,
  }));
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
    if (path === "land")
      return reply({
        accountId,
        items: landReadable
          ? url.searchParams.has("after")
            ? landRows.slice(2)
            : landRows.slice(0, 2)
          : [],
        nextCursor:
          landReadable && !url.searchParams.has("after") ? ids[1] : null,
      });
    if (path === "land/detail") {
      if (!landReadable) return reply({ error: "Not available" }, 404);
      return reply({
        accountId,
        land: landRows.find((row) => row.id === url.searchParams.get("id")),
      });
    }
    if (path === "auth/csrf")
      return reply({
        accountId,
        deviceId,
        csrfToken: `${"B".repeat(43)}.${"C".repeat(43)}`,
      });
    if (path === "farmers/change") {
      if (!verifyAllowed) return reply({ error: "Denied" }, 403);
      const input = route.request().postDataJSON();
      assert.equal(input.action, "verification");
      assert.equal(input.farmerId, ids[0]);
      assert.equal(input.expectedVersion, 1);
      verificationCalls++;
      if (!verificationReceipt) {
        rows[0].status = "verified";
        rows[0].version = 2;
        verificationReceipt = {
          mutationId: input.mutationId,
          version: 2,
          occurredAt: "2026-11-15T20:00:00.123456Z",
        };
        return route.abort("failed");
      }
      assert.equal(input.mutationId, verificationReceipt.mutationId);
      return reply({
        farmerId: ids[0],
        version: 2,
        replayed: true,
        duplicateRisk: false,
      });
    }
    if (path === "farmers/correction-receipt") {
      if (!correctionAllowed) return reply({ error: "Denied" }, 403);
      return reply({
        accountId,
        farmerId: url.searchParams.get("id"),
        receipt: {
          mutationId: ids[1],
          version: 3,
          occurredAt: "2026-11-16T00:00:00.123456Z",
        },
        sessionId: "synthetic-private",
      });
    }
    if (path === "farmers/verification-receipt") {
      if (!verifyAllowed) return reply({ error: "Denied" }, 403);
      return reply({
        accountId,
        farmerId: url.searchParams.get("id"),
        receipt: verificationReceipt,
      });
    }
    if (path === "farmers") {
      const status = url.searchParams.get("status"),
        reviewable = url.searchParams.get("reviewable");
      const filters = {
        ...(status ? { status } : {}),
        ...(reviewable ? { reviewable } : {}),
      };
      const visible = readable
        ? rows.filter(
            (row) =>
              (!status || row.status === status) &&
              (!reviewable ||
                (verifyAllowed && row.status === "pending-review")),
          )
        : [];
      return reply({
        accountId,
        ...(Object.keys(filters).length ? { filters } : {}),
        items: url.searchParams.has("after")
          ? visible.slice(2)
          : visible.slice(0, 2),
        nextCursor:
          visible.length > 2 && !url.searchParams.has("after")
            ? visible[1].id
            : null,
      });
    }
    if (path === "farmers/detail")
      return reply({
        accountId,
        farmer: rows.find((row) => row.id === url.searchParams.get("id")),
        access: {
          viewAudit: auditable,
          verify: verifyAllowed,
          correct: correctionAllowed,
        },
      });
    if (path === "farmers/history") {
      if (!auditable) return reply({ error: "Action denied" }, 403);
      const older = url.searchParams.has("beforeTime");
      if (older)
        assert.equal(
          url.searchParams.get("beforeTime"),
          "2026-11-15T12:00:00.123457Z",
        );
      const before = {
        fullName: "Synthetic historic name",
        geographyId: rows[0].geographyId,
        geographyName: rows[0].geographyName,
        status: "pending-review",
      };
      return reply({
        accountId,
        farmerId: ids[0],
        items: [
          {
            eventId: older ? ids[0] : ids[2],
            occurredAt: older
              ? "2026-11-15T12:00:00.123456Z"
              : "2026-11-15T12:00:00.123457Z",
            actorAccountId: accountId,
            action: older ? "registration" : "correction",
            change: older
              ? null
              : {
                  reason: "Synthetic audit correction reason",
                  previousVersion: 1,
                  resultVersion: 2,
                  duplicateRisk: false,
                  previous: before,
                  result: { ...before, fullName: rows[0].fullName },
                },
          },
        ],
        nextCursor: older
          ? null
          : { beforeTime: "2026-11-15T12:00:00.123457Z", beforeId: ids[2] },
      });
    }
    throw new Error("Unexpected synthetic registry request");
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  await page
    .getByRole("combobox", { name: "Registration status", exact: true })
    .selectOption("pending-review");
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  await page
    .getByRole("checkbox", {
      name: "Only pending records I may verify",
      exact: true,
    })
    .check();
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  assert.equal(
    new URL(page.url()).searchParams.get("farmerStatus"),
    "pending-review",
  );
  assert.equal(new URL(page.url()).searchParams.get("reviewable"), "true");
  await page.reload();
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "Only pending records I may verify",
        exact: true,
      })
      .isChecked(),
    true,
  );
  await page
    .getByRole("combobox", { name: "Registration status", exact: true })
    .selectOption("all");
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has("reviewable"), false);
  assert.equal(new URL(page.url()).searchParams.has("farmerStatus"), false);
  assert.equal(
    await page
      .getByRole("button", { name: "Previous page", exact: true })
      .isDisabled(),
    true,
  );
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
  await page
    .getByRole("button", { name: "Show record history", exact: true })
    .click();
  await page
    .getByText("Synthetic audit correction reason", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "සිංහල", exact: true }).click();
  await page
    .getByRole("heading", { name: "වාර්තා ඉතිහාසය", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Older events", exact: true }).click();
  await page
    .getByText(
      "This registration event records who and when. Original field values were not captured.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (await page.locator("body").innerText()).includes(
      "Synthetic historic name",
    ),
    false,
  );
  auditable = false;
  await page
    .getByRole("button", { name: "Latest events", exact: true })
    .click();
  await page.getByRole("main").getByRole("alert").waitFor();
  await page
    .getByRole("heading", { name: "Record history", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("heading", { name: "Record history", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByText(rows[0].fullName, { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Check session and refresh", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `View record: ${rows[0].fullName}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: rows[0].fullName, exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Show record history", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Close record", exact: true }).click();
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
  await page.getByRole("button", { name: "සිංහල", exact: true }).click();
  await page.getByRole("heading", { name: "ගොවි ලේඛනය", exact: true }).waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("button", {
      name: `View record: ${rows[0].fullName}`,
      exact: true,
    })
    .click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm record review", exact: true })
    .click();
  await page.getByText(/The outcome is uncertain/).waitFor();
  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.accept()),
    page.reload(),
  ]);
  await page
    .getByRole("button", {
      name: `View record: ${rows[0].fullName}`,
      exact: true,
    })
    .click();
  await page.getByText("Verified", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Confirm record review", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", {
      name: "Check my latest verification receipt",
      exact: true,
    })
    .click();
  await page
    .getByText("Your latest visible verification", { exact: true })
    .waitFor();
  assert.equal(verificationCalls, 1);
  await page.getByRole("button", { name: "සිංහල", exact: true }).click();
  await page.getByText("කාර්ය මණ්ඩල වාර්තා සමාලෝචනය", { exact: true }).waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Check my latest correction receipt",
      exact: true,
    })
    .click();
  await page
    .getByRole("region", {
      name: "Your latest visible correction",
      exact: true,
    })
    .getByText("3", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "සිංහල", exact: true }).click();
  await page
    .getByRole("heading", { name: "ඔබගේ නවතම අවසර ලත් නිවැරදි කිරීම", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  correctionAllowed = false;
  await page
    .getByRole("button", {
      name: "Check my latest correction receipt",
      exact: true,
    })
    .click();
  await page.getByRole("main").getByRole("alert").waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: rows[0].fullName, exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Check session and refresh", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `View record: ${rows[0].fullName}`,
      exact: true,
    })
    .click();
  await page.getByText("Verified", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Check my latest correction receipt",
        exact: true,
      })
      .count(),
    0,
  );
  verifyAllowed = false;
  await page
    .getByRole("button", {
      name: "Check my latest verification receipt",
      exact: true,
    })
    .click();
  await page.getByRole("main").getByRole("alert").waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: rows[0].fullName, exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Reported land", exact: true })
    .click();
  await page.getByText(landRows[0].label, { exact: true }).waitFor();
  assert.equal(
    await page.getByText(rows[0].fullName, { exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByText(landRows[2].label, { exact: true }).waitFor();
  await page
    .getByRole("button", {
      name: `View land: ${landRows[2].label} (${ids[2]})`,
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: landRows[2].label, exact: true })
    .waitFor();
  await page.getByText("GPS not recorded", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close land", exact: true }).click();
  await page
    .getByRole("button", {
      name: `View land: ${landRows[0].label} (${ids[0]})`,
      exact: true,
    })
    .click();
  await page.getByText("Latitude", { exact: true }).waitFor();
  await page.getByText("80.25", { exact: true }).waitFor();
  await page.getByRole("button", { name: "සිංහල", exact: true }).click();
  await page
    .getByRole("heading", { name: "වාර්තා කළ ඉඩම් ලේඛනය", exact: true })
    .waitFor();
  await page.getByText("අක්ෂාංශ", { exact: true }).waitFor();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Close land", exact: true }).click();
  await page.getByText(landRows[0].label, { exact: true }).waitFor();
  landReadable = false;
  await page
    .getByRole("button", {
      name: `View land: ${landRows[0].label} (${ids[0]})`,
      exact: true,
    })
    .click();
  await page.getByRole("main").getByRole("alert").waitFor();
  assert.equal(await page.getByText("80.25", { exact: true }).count(), 0);
  for (const record of landRows)
    assert.equal(
      await page.getByText(record.label, { exact: true }).count(),
      0,
    );
  await page.getByRole("button", { name: "Farmers", exact: true }).click();
  await page.getByText(rows[0].fullName, { exact: true }).waitFor();
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
  const preferenceTab = await context.newPage();
  await preferenceTab.goto(origin);
  await preferenceTab
    .getByRole("button", { name: "සිංහල", exact: true })
    .click();
  await page.waitForFunction(() => document.documentElement.lang === "si");
  await page.getByRole("heading", { name: "ගොවි ලේඛනය", exact: true }).waitFor();
  await preferenceTab
    .getByRole("button", { name: "English", exact: true })
    .click();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await preferenceTab.close();
  console.log(
    "Chromium passed: compiled API startup, admin review queue/bookmark recovery, verification/lost-acknowledgement recovery and farmer/land pagination/detail/history, bilingual and cross-tab locale controls, audit/scope/session rejection cleanup and no browser farmer persistence.",
  );
} finally {
  if (browser) await browser.close();
  for (const child of children.reverse())
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((done) => child.once("exit", done));
    }
}
