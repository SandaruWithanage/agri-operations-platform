import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthShell } from "../packages/ui/src/auth-shell";
import { LocaleToggle } from "../packages/ui/src/locale-toggle";

afterEach(() => cleanup());

it("gives each language button its full name and reports the pressed one", async () => {
  const change = vi.fn();
  render(<LocaleToggle value="en" onChange={change} label="Language" />);
  const english = screen.getByRole("button", { name: "English", exact: true });
  const sinhala = screen.getByRole("button", { name: "සිංහල", exact: true });
  expect(screen.getByRole("group", { name: "Language" })).toBeTruthy();
  expect(english.getAttribute("aria-pressed")).toBe("true");
  expect(sinhala.getAttribute("aria-pressed")).toBe("false");
  // English is shortened but its name is contained in the accessible name; Sinhala
  // shows the full word rather than a single glyph (WCAG 2.5.3, font coverage).
  expect(english.textContent).toBe("EN");
  expect(sinhala.textContent).toBe("සිංහල");
  expect(sinhala.getAttribute("lang")).toBe("si");
  await userEvent.click(sinhala);
  expect(change).toHaveBeenCalledWith("si");
  expect(english.getAttribute("type")).toBe("button");
});

it("lays out one heading, one main landmark, a skip link and the supplied form", () => {
  render(
    <AuthShell
      brandName="GoviAxis"
      brandTagline="Secure access"
      points={["First point", "Second point"]}
      skipLabel="Skip to sign-in"
      title="Sign in"
      intro="Use your organization account."
      toolbar={<span>toolbar</span>}
      footer={<span>footer note</span>}
    >
      <form aria-label="login form" />
    </AuthShell>,
  );
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
  const main = screen.getByRole("main");
  expect(main.id).toBe("agri-auth-main");
  expect(
    screen.getByRole("link", { name: "Skip to sign-in" }).getAttribute("href"),
  ).toBe("#agri-auth-main");
  expect(main.contains(screen.getByRole("form", { name: "login form" }))).toBe(
    true,
  );
  expect(
    screen.getAllByRole("listitem").map((item) => item.textContent),
  ).toEqual(["First point", "Second point"]);
  expect(screen.getByText("Use your organization account.")).toBeTruthy();
  expect(screen.getByText("footer note")).toBeTruthy();
});

it("writes the status as text in every tone", async () => {
  const { StatusPill } = await import("../packages/ui/src/status-pill");
  render(
    <>
      <StatusPill tone="draft">Draft</StatusPill>
      <StatusPill tone="pending">Pending review</StatusPill>
      <StatusPill tone="verified">Verified</StatusPill>
      <StatusPill tone="inactive">Inactive</StatusPill>
    </>,
  );
  for (const [label, tone] of [
    ["Draft", "draft"],
    ["Pending review", "pending"],
    ["Verified", "verified"],
    ["Inactive", "inactive"],
  ])
    expect(screen.getByText(label).className).toContain(`agri-pill--${tone}`);
});
