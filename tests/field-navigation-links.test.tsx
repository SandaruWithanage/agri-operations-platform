import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { PilotWorkspace } from "../apps/field-pwa/components/pilot-workspace";
import { PilotClient } from "../apps/field-pwa/lib/pilot-client";
import { vi } from "vitest";

afterEach(() => cleanup());
const css = readFileSync("apps/field-pwa/app/globals.css", "utf8");
const tokens = readFileSync("packages/design-tokens/src/tokens.css", "utf8");
// Resolve a `min-height` value that may be a design token (var(--agri-...)) to px.
const minHeightPx = (declarations: string): number => {
  const raw = /min-height:\s*([^;]+);/.exec(declarations)?.[1]?.trim() ?? "";
  const name = /^var\((--agri-[a-z-]+)\)$/.exec(raw)?.[1];
  const value = name
    ? new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim()
    : raw;
  return Number(/^(\d+)px$/.exec(value ?? "")?.[1]);
};
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} rule exists`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

describe("field navigation links (issue #69)", () => {
  it.each([
    [
      "en",
      "Field navigation",
      "Open encrypted offline workspace",
      "Survey a land perimeter (online)",
    ],
    [
      "si",
      "ක්ෂේත්‍ර සංචලනය",
      "සංකේතනය කළ නොබැඳි වැඩපොළ විවෘත කරන්න",
      "ඉඩම් මායිම මැනීම (සබැඳිව)",
    ],
  ] as const)(
    "renders both links as touch-target links inside a labelled navigation (%s)",
    (language, label, offline, survey) => {
      const client = new PilotClient();
      vi.spyOn(client, "context").mockRejectedValue(new Error("not signed in"));
      render(<PilotWorkspace language={language} client={client} />);
      const nav = screen.getByRole("navigation", { name: label });
      expect(nav.className).toContain("workspace-nav");
      const offlineLink = screen.getByRole("link", { name: offline });
      const surveyLink = screen.getByRole("link", { name: survey });
      expect(offlineLink.getAttribute("href")).toBe("/offline-workspace");
      expect(surveyLink.getAttribute("href")).toBe("/land-survey");
      for (const link of [offlineLink, surveyLink]) {
        expect(link.className).toContain("nav-link");
        expect(nav.contains(link)).toBe(true);
      }
    },
  );

  it("sizes, spaces and outlines the links in the stylesheet", () => {
    const link = rule(".nav-link");
    expect(minHeightPx(link)).toBeGreaterThanOrEqual(44);
    expect(link).toMatch(/padding:\s*\d+px/);
    expect(link).toContain("overflow-wrap: anywhere");
    expect(
      Number(/gap:\s*(\d+)px/.exec(rule(".workspace-nav"))?.[1]),
    ).toBeGreaterThanOrEqual(8);
    expect(rule(".nav-link:focus-visible")).toMatch(/outline:\s*3px solid/);
    // Sign-in inputs must never be wider than the narrowest phone layout.
    expect(
      rule(
        '.registration-form input:not([type="checkbox"]),\n.registration-form select',
      ),
    ).toContain("width: 100%");
  });
});
