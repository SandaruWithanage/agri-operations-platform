/**
 * Independent Chromium UI/UX QA against production Next.js builds.
 * All authenticated pages use synthetic Playwright transport fixtures.
 * No real farmer data, production login, or screenshots of live accounts.
 */
import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const output = resolve("qa-artifacts/ui-ux");
await mkdir(output, { recursive: true });
const findings = [];
const children = [];
let browser;
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const landId = "06149451-4004-4a23-a5a2-64a24e485a82";
const scenarios = [
  { name: "admin-desktop", app: "admin-web", width: 1440, height: 900 },
  { name: "admin-mobile", app: "admin-web", width: 390, height: 844 },
  { name: "admin-small-mobile", app: "admin-web", width: 320, height: 740 },
  { name: "field-desktop", app: "field-pwa", width: 1440, height: 900 },
  { name: "field-mobile", app: "field-pwa", width: 390, height: 844 },
  { name: "field-small-mobile", app: "field-pwa", width: 320, height: 740 },
];

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const number = server.address().port;
  await new Promise((done) => server.close(done));
  return number;
}
async function ready(origin, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null)
      throw new Error(
        "Next.js process exited before readiness: " + child.exitCode,
      );
    const ok = await new Promise((done) => {
      const request = get(origin, (res) => {
        res.resume();
        done(res.statusCode === 200);
      });
      request.setTimeout(1000, () => request.destroy());
      request.on("error", () => done(false));
    });
    if (ok) return;
    await delay(150);
  }
  throw new Error("Next.js readiness timeout: " + origin);
}
async function start(app) {
  const port = await freePort();
  const proc = spawn(
    process.execPath,
    [
      resolve("apps/" + app + "/node_modules/next/dist/bin/next"),
      "start",
      "-p",
      String(port),
    ],
    {
      cwd: resolve("apps/" + app),
      env: {
        ...process.env,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        // The screenshot harness must never use production API endpoints.
        PILOT_API_ORIGIN: "",
        ENABLE_PILOT_AUTH: "false",
      },
      stdio: "ignore",
    },
  );
  children.push(proc);
  const origin = "http://127.0.0.1:" + port;
  await ready(origin, proc);
  return origin;
}
function safeName(name) {
  return name.replace(/[^a-z0-9-]/gi, "-");
}
async function checkLayout(page, name) {
  const details = await page.evaluate(() => {
    const view = document.documentElement.clientWidth;
    const width = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const fields = [
      ...document.querySelectorAll("input:not([type=hidden]),select,textarea"),
    ];
    const unlabeled = fields
      .filter((field) => {
        const rect = field.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          !(
            field.labels?.length ||
            field.getAttribute("aria-label") ||
            field.getAttribute("aria-labelledby")
          )
        );
      })
      .map((field) => field.getAttribute("name") || field.id || field.tagName);
    // Advisory: WCAG target size needs additional spacing considerations.
    const small = [
      ...document.querySelectorAll("button,a,input[type=submit],select"),
    ]
      .flatMap((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        if (!rect.width || !rect.height || style.visibility === "hidden")
          return [];
        if (rect.width >= 44 && rect.height >= 44) return [];
        return [
          {
            role: node.tagName.toLowerCase(),
            label: (node.textContent || node.getAttribute("aria-label") || "")
              .trim()
              .slice(0, 90),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        ];
      })
      .slice(0, 30);
    return {
      viewportWidth: view,
      scrollWidth: width,
      unlabeled,
      smallTouchTargets: small,
      title: document.title,
    };
  });
  assert.ok(
    details.scrollWidth <= details.viewportWidth + 2,
    name + ": horizontal overflow " + JSON.stringify(details),
  );
  assert.deepEqual(
    details.unlabeled,
    [],
    name + ": visible form controls must have accessible labels",
  );
  return details;
}
async function runCase(name, app, origin, viewport, work) {
  const row = {
    name,
    app,
    viewport,
    status: "pass",
    warnings: [],
    pageErrors: [],
  };
  findings.push(row);
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: "en-GB",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    row.pageErrors.push(error.message.slice(0, 400)),
  );
  try {
    await work(page, context, origin, row);
    row.layout = await checkLayout(page, name);
    row.warnings = row.layout.smallTouchTargets;
    assert.deepEqual(row.pageErrors, [], name + ": JavaScript page errors");
    await page.screenshot({
      path: join(output, safeName(name) + ".png"),
      fullPage: true,
      animations: "disabled",
    });
  } catch (error) {
    row.status = "fail";
    row.error = String(error?.stack ?? error).slice(0, 1500);
    try {
      await page.screenshot({
        path: join(output, safeName(name) + "-failed.png"),
        fullPage: true,
      });
    } catch {
      /* Best-effort screenshot/trace cleanup must not mask test failures. */
    }
    process.stderr.write("FAIL " + name + ": " + String(error) + "\n");
  } finally {
    try {
      await context.tracing.stop({
        path: join(output, safeName(name) + "-trace.zip"),
      });
    } catch {
      /* Best-effort screenshot/trace cleanup must not mask test failures. */
    }
    await context.close();
  }
}
function mockLandSurvey(page, getSessionActive) {
  return page.route("**/api/pilot/**", async (route) => {
    const url = new globalThis.URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/pilot\//, "");
    const send = (value, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify(value),
      });
    if (path === "auth/csrf") {
      if (!getSessionActive())
        return send({ error: "Authentication required" }, 401);
      return send({
        accountId,
        deviceId,
        csrfToken: "A".repeat(43) + "." + "B".repeat(43),
      });
    }
    if (!getSessionActive())
      return send({ error: "Authentication required" }, 401);
    if (path === "land")
      return send({
        accountId,
        items: [
          {
            id: landId,
            label: "Synthetic plot A",
            geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
            geographyName: "Synthetic village",
            point: null,
            reportedAreaHectares: null,
            createdAt: "2026-11-15T10:00:00.000Z",
            version: 1,
            identificationOnly: true,
          },
        ],
        nextCursor: null,
      });
    if (path === "land/geometry")
      return send({ accountId, landId, current: null, history: [] });
    return send({ error: "Not found" }, 404);
  });
}
try {
  const origins = {
    "admin-web": await start("admin-web"),
    "field-pwa": await start("field-pwa"),
  };
  browser = await chromium.launch({
    headless: true,
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
  });
  for (const profile of scenarios) {
    await runCase(
      profile.name,
      profile.app,
      origins[profile.app],
      { width: profile.width, height: profile.height },
      async (page, _ctx, origin) => {
        const response = await page.goto(origin + "/", {
          waitUntil: "domcontentloaded",
        });
        assert.equal(response?.status(), 200, "home page should load");
        if (profile.app === "field-pwa") {
          await page
            .getByRole("button", { name: "English", exact: true })
            .click();
          await page.locator("input[name=loginName]").waitFor();
          assert.ok(await page.locator("input[name=password]").count());
          assert.ok(await page.locator("input[name=otp]").count());
          assert.ok(
            await page
              .getByRole("link", { name: /Survey a land perimeter/i })
              .count(),
          );
        } else {
          await page.locator("input[name=loginName]").waitFor();
          assert.ok(await page.locator("input[name=password]").count());
          assert.ok(await page.locator("input[name=otp]").count());
        }
      },
    );
  }
  await runCase(
    "field-sinhala-mobile",
    "field-pwa",
    origins["field-pwa"],
    { width: 390, height: 844 },
    async (page, _ctx, origin) => {
      await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "සිංහල", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "සිංහල", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.ok((await page.locator("main").innerText()).includes("පුර"));
    },
  );
  for (const width of [390, 1440]) {
    const name = "field-land-survey-" + width;
    await runCase(
      name,
      "field-pwa",
      origins["field-pwa"],
      { width, height: width === 390 ? 844 : 900 },
      async (page, ctx, origin) => {
        let active = true;
        await mockLandSurvey(page, () => active);
        await ctx.grantPermissions(["geolocation"], { origin });
        await ctx.setGeolocation({
          longitude: 80.25,
          latitude: 8.3,
          accuracy: 8,
        });
        await page.goto(origin + "/land-survey", {
          waitUntil: "domcontentloaded",
        });
        await page
          .getByRole("button", { name: "English", exact: true })
          .click();
        const dropdown = page.getByLabel("Land", { exact: true });
        await dropdown.waitFor();
        await dropdown.selectOption(landId);
        await page.getByRole("button", { name: "Start recording" }).waitFor();
        await page.getByRole("button", { name: "Start recording" }).click();
        active = false;
        await page.evaluate(() =>
          window.dispatchEvent(new window.Event("focus")),
        );
        await page
          .getByText(/kept in memory but hidden/i)
          .first()
          .waitFor();
        // A signed-out browser must not show another officer the previous private land information.
        assert.equal(await page.getByText("Synthetic plot A").count(), 0);
        assert.equal(
          await page
            .getByRole("button", { name: "Pause", exact: true })
            .count(),
          0,
        );
        assert.equal(await page.getByLabel("Land", { exact: true }).count(), 0);
      },
    );
  }
} catch (error) {
  findings.push({
    name: "harness-startup",
    status: "fail",
    error: String(error?.stack ?? error).slice(0, 1500),
  });
  process.stderr.write("Harness startup failed: " + String(error) + "\n");
} finally {
  try {
    await browser?.close();
  } catch {
    /* Best-effort screenshot/trace cleanup must not mask test failures. */
  }
  for (const child of children) {
    child.kill("SIGTERM");
  }
  const counts = {
    passed: findings.filter((x) => x.status === "pass").length,
    failed: findings.filter((x) => x.status === "fail").length,
  };
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        schema: "agri-ui-ux-qa-v1",
        timestamp: new Date().toISOString(),
        note: "Synthetic screenshot evidence. Browser UI checks are not a full accessibility, visual-design, or production backend assessment.",
        counts,
        findings,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    "Independent Chromium UI/UX QA: " + JSON.stringify(counts) + "\n",
  );
  if (counts.failed > 0) process.exitCode = 1;
}
