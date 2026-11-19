import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { colors, radii, tapTargets } from "../packages/design-tokens/src/index";

const read = (path: string) => readFileSync(resolve(path), "utf8");
const tokensCss = read("packages/design-tokens/src/tokens.css");
const appStylesheets = [
  "apps/admin-web/app/globals.css",
  "apps/field-pwa/app/globals.css",
];

const cssVars = new Map(
  [...tokensCss.matchAll(/(--agri-[a-z-]+):\s*([^;]+);/g)].map((m) => [
    m[1],
    m[2].trim(),
  ]),
);
const color = (name: string) => {
  const value = cssVars.get(`--agri-color-${name}`);
  if (!value) throw new Error(`Missing token ${name}`);
  return value;
};

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Colour of a white glass surface after it is blended over the backdrop.
function glassOver(backdrop: string): string {
  const alpha = Number(cssVars.get("--agri-glass-alpha"));
  const channel = (i: number) =>
    Math.round(
      255 * alpha +
        parseInt(backdrop.slice(1 + i * 2, 3 + i * 2), 16) * (1 - alpha),
    )
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

describe("design tokens", () => {
  it("keeps the TypeScript mirror identical to tokens.css", () => {
    const kebab = (s: string) =>
      s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    for (const [name, value] of Object.entries(colors))
      expect(color(kebab(name)), name).toBe(value);
    for (const [name, value] of Object.entries(radii))
      expect(cssVars.get(`--agri-radius-${kebab(name)}`), name).toBe(value);
    expect(cssVars.get("--agri-tap-min")).toBe(`${tapTargets.min}px`);
    expect(cssVars.get("--agri-tap-comfortable")).toBe(
      `${tapTargets.comfortable}px`,
    );
  });

  // WCAG AA: 4.5:1 for normal text, 3:1 for large text and UI components.
  const textPairs: Array<[string, string, string]> = [
    ["body text on page", "text", "bg"],
    ["body text on card", "text", "surface"],
    ["muted text on page", "text-muted", "bg"],
    ["muted text on card", "text-muted", "surface"],
    ["link on page", "link", "bg"],
    ["link on card", "link", "surface"],
    ["status text on status background", "status-text", "status-bg"],
    ["danger text on card", "danger-text", "surface"],
    ["danger text on page", "danger-text", "bg"],
    ["control text on card", "control-text", "surface"],
    ["text on table header", "text", "table-head-bg"],
    ["text on pressed background", "text", "pressed-bg"],
    ["subtle text on page", "text-subtle", "bg"],
    ["subtle text on card", "text-subtle", "surface"],
    ["subtle text on pale surface", "text-subtle", "surface-pale"],
    ["subtle text on soft green", "text-subtle", "status-bg"],
    ["warning text on warning background", "warning-text", "warning-bg"],
    ["warning text on card", "warning-text", "surface"],
    ["white on forest (sidebar and brand panel)", "surface", "forest"],
    ["muted navigation text on forest", "nav-muted", "forest"],
    ["forest text on pale surface", "forest", "surface-pale"],
    ["draft pill text", "pill-draft-text", "pill-draft-bg"],
    ["pending pill text", "pill-pending-text", "pill-pending-bg"],
    ["verified pill text", "pill-verified-text", "pill-verified-bg"],
    ["inactive pill text", "pill-inactive-text", "pill-inactive-bg"],
    ["active nav text on pale surface", "forest", "surface-pale"],
  ];
  it.each(textPairs)("meets 4.5:1 for %s", (_label, fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  const uiPairs: Array<[string, string, string]> = [
    ["keyboard focus ring on page", "focus", "bg"],
    ["keyboard focus ring on card", "focus", "surface"],
    ["input border on card", "input-border", "surface"],
    ["control border on card", "control-border", "surface"],
    ["light focus ring on forest", "focus-on-dark", "forest"],
  ];
  it.each(uiPairs)("meets 3:1 for %s", (_label, fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(3);
  });

  it("keeps touch targets at the documented minimums", () => {
    expect(tapTargets.min).toBeGreaterThanOrEqual(44);
    expect(tapTargets.comfortable).toBeGreaterThanOrEqual(48);
  });

  describe.each(appStylesheets)("%s", (path) => {
    const css = read(path);
    it("imports the shared tokens", () => {
      expect(css).toContain('@import "@agri/design-tokens/tokens.css";');
    });
    it("uses no hard-coded hex colours", () => {
      expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    });
    it("uses only tokens that are defined", () => {
      const used = new Set(
        [...css.matchAll(/var\((--agri-[a-z-]+)\)/g)].map((m) => m[1]),
      );
      expect(used.size).toBeGreaterThan(0);
      for (const name of used) expect(cssVars.has(name), name).toBe(true);
    });
  });

  describe("frosted glass", () => {
    const worst = () => cssVars.get("--agri-glass-backdrop-worst") as string;
    it("keeps the glass settings present and sane", () => {
      const alpha = Number(cssVars.get("--agri-glass-alpha"));
      expect(alpha).toBeGreaterThanOrEqual(0.75);
      expect(alpha).toBeLessThanOrEqual(1);
      expect(
        parseInt(cssVars.get("--agri-glass-blur") ?? "99", 10),
      ).toBeLessThanOrEqual(16);
    });
    it("never lets the page backdrop be darker than the tested worst case", () => {
      const stops = (cssVars.get("--agri-backdrop") ?? "").match(
        /#[0-9a-f]{6}/gi,
      );
      expect(stops?.length).toBeGreaterThan(1);
      for (const stop of stops ?? [])
        expect(luminance(stop)).toBeGreaterThanOrEqual(luminance(worst()));
    });
    it.each([
      ["text", "text"],
      ["muted text", "text-muted"],
      ["subtle text", "text-subtle"],
      ["forest text", "forest"],
      ["link", "link"],
      ["danger text", "danger-text"],
    ])("%s keeps 4.5:1 on glass over the darkest backdrop", (_label, token) => {
      expect(contrast(color(token), glassOver(worst()))).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  });
});
