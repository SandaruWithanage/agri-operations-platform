import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

/**
 * Real-browser smoke check of the field app's navigation links as touch targets (issue #69): at the widths a
 * phone uses, in both languages, each link must be large enough to tap, spaced from its neighbour, and keep a
 * visible focus outline, and the page must not scroll sideways. Synthetic production build, no real data.
 */
const minimumHeight = 44;
const minimumGap = 8;
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
    if (child.exitCode !== null) throw new Error("Field app exited");
    await delay(100);
  }
  throw new Error("Field app readiness timeout");
}
try {
  const fieldPort = await port();
  const app = spawn(
    process.execPath,
    [
      resolve("apps/field-pwa/node_modules/next/dist/bin/next"),
      "start",
      "-p",
      String(fieldPort),
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
  children.push(app);
  const origin = `http://127.0.0.1:${fieldPort}`;
  await ready(origin, app);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
  });
  for (const width of [320, 390, 768]) {
    for (const language of ["English", "සිංහල"]) {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        hasTouch: true,
        isMobile: width < 700,
      });
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: language, exact: true }).click();
      const label = `${width}px ${language}`;
      const links = page.locator("nav.workspace-nav a.nav-link");
      assert.equal(await links.count(), 2, `${label}: two navigation links`);
      const boxes = [
        await links.nth(0).boundingBox(),
        await links.nth(1).boundingBox(),
      ];
      for (const box of boxes)
        assert.ok(
          box.height >= minimumHeight,
          `${label}: link ${box.height}px high`,
        );
      const gap = boxes[1].y - (boxes[0].y + boxes[0].height);
      assert.ok(gap >= minimumGap, `${label}: gap ${gap}px between links`);
      assert.ok(
        (await page.evaluate(() => document.documentElement.scrollWidth)) <=
          width,
        `${label}: the page scrolls sideways`,
      );
      // Keyboard focus is clearly visible on the link itself, reached with Tab like a keyboard user would.
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      let reached = false;
      for (let presses = 0; presses < 40 && !reached; presses++) {
        await page.keyboard.press("Tab");
        reached = await links
          .nth(0)
          .evaluate((element) => element === document.activeElement);
      }
      assert.ok(
        reached,
        `${label}: the first link is not reachable with the keyboard`,
      );
      const outline = await links.nth(0).evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          style: style.outlineStyle,
          width: Number.parseFloat(style.outlineWidth),
        };
      });
      assert.notEqual(outline.style, "none", `${label}: no focus outline`);
      assert.ok(
        outline.width >= 2,
        `${label}: focus outline ${outline.width}px`,
      );
      await context.close();
    }
  }
  const narrow = await browser.newPage({
    viewport: { width: 320, height: 800 },
  });
  await narrow.goto(`${origin}/offline-workspace`, {
    waitUntil: "networkidle",
  });
  const back = await narrow.locator("a.nav-link").first().boundingBox();
  assert.ok(
    back.height >= minimumHeight,
    `offline sign-in link ${back.height}px high`,
  );
  assert.ok(
    (await narrow.evaluate(() => document.documentElement.scrollWidth)) <= 320,
    "offline page scrolls sideways at 320px",
  );
  console.log(
    "Chromium passed: field navigation touch targets, spacing, focus and reflow at 320, 390 and 768px in English and Sinhala",
  );
} finally {
  await browser?.close();
  for (const child of children) child.kill();
}
