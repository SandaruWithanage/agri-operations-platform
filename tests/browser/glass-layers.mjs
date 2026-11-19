import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

/**
 * Real-browser check of issue 101: inside one frosted-glass surface, no descendant may apply a second
 * backdrop filter. The page is built from the real stylesheets with synthetic markup (no app, no data), so
 * it runs without the stack. It is checked at a phone width and a desktop width, and with more contrast
 * requested, where every surface must be solid and unfiltered.
 */
const root = resolve(import.meta.dirname, "../..");
const css =
  readFileSync(resolve(root, "packages/design-tokens/src/tokens.css"), "utf8") +
  readFileSync(resolve(root, "packages/ui/src/ui.css"), "utf8");

const markup = `
<div class="agri-shell"><aside class="agri-shell__side"><section id="side-inner"></section></aside>
<header class="agri-shell__top"></header>
<main class="agri-shell__main">
  <section id="outer">
    <fieldset id="in-section-fieldset"><section id="deep-section"></section></fieldset>
    <div class="table-scroll" id="in-section-table"><fieldset id="table-fieldset"></fieldset></div>
  </section>
  <fieldset id="top-fieldset"><div class="table-scroll" id="fieldset-table"></div></fieldset>
  <div class="table-scroll" id="top-table"></div>
</main></div>
<div class="agri-auth"><div class="agri-auth__card" id="card"><fieldset id="card-fieldset"></fieldset></div></div>
<div class="field-frame"><div class="card" id="field-card"><div class="card" id="field-card-inner"></div></div></div>`;

const surfaces =
  ".agri-glass, .agri-auth__card, .agri-shell__side, .agri-shell__top, .agri-shell__main section, .agri-shell__main .table-scroll, .agri-shell__main fieldset, .field-frame .card";

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  });
  for (const [label, width, contrast] of [
    ["phone", 390, "no-preference"],
    ["desktop", 1280, "no-preference"],
    ["more contrast", 1280, "more"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(
      `<!doctype html><style>${css}</style><body>${markup}</body>`,
    );
    try {
      await page.emulateMedia({ contrast });
    } catch {
      if (contrast === "more") {
        await page.close();
        continue; // this Playwright build cannot emulate the preference; the other two widths still run
      }
    }
    const result = await page.evaluate((selector) => {
      const filter = (el) => {
        const style = globalThis.getComputedStyle(el);
        return style.backdropFilter || style.webkitBackdropFilter || "none";
      };
      const glass = [...document.querySelectorAll(selector)];
      return glass.map((el) => {
        const filtered = filter(el) !== "none";
        let parent = el.parentElement;
        let filteredAncestor = false;
        while (parent) {
          if (glass.includes(parent) && filter(parent) !== "none")
            filteredAncestor = true;
          parent = parent.parentElement;
        }
        return { id: el.id || el.className, filtered, filteredAncestor };
      });
    }, surfaces);
    assert.ok(
      result.length >= 12,
      `${label}: expected the synthetic surfaces, saw ${result.length}`,
    );
    const doubled = result.filter((r) => r.filtered && r.filteredAncestor);
    assert.deepEqual(doubled, [], `${label}: nested backdrop filters found`);
    if (contrast === "more") {
      assert.deepEqual(
        result.filter((r) => r.filtered),
        [],
        "more contrast: every surface must be solid and unfiltered",
      );
    } else {
      // The outermost surfaces still carry the glass layer: the fix must not remove glass everywhere.
      const outer = result.filter((r) => !r.filteredAncestor);
      assert.ok(
        outer.some((r) => r.id === "outer" && r.filtered),
        `${label}: the outer section lost its glass layer`,
      );
      assert.ok(
        outer.some((r) => r.id === "card" && r.filtered),
        `${label}: the sign-in card lost its glass layer`,
      );
    }
    await page.close();
  }
  console.log("glass layers: one backdrop filter per surface hierarchy");
} finally {
  await browser?.close();
}
