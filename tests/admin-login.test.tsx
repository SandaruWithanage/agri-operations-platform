import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";

// Issue #71 (OWNER-D1): the admin sign-in uses the shared layout. These tests pin
// what must NOT change (fields, names, security attributes, recovery controls) and
// what the redesign fixed (no record navigation before sign-in).
function signedOut() {
  const api = new PilotClient();
  vi.spyOn(api, "context").mockRejectedValue(new PilotRequestError(401));
  vi.spyOn(api, "farmers").mockRejectedValue(new PilotRequestError(401));
  vi.spyOn(api, "logout").mockResolvedValue();
  return api;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("shows the sign-in page without any record navigation", async () => {
  render(<FarmerRegistry client={signedOut()} />);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Sign in" }),
  ).toBeTruthy();
  expect(screen.getByRole("main").id).toBe("agri-auth-main");
  for (const tab of ["Farmers", "Projects", "Enrollments", "Reported land"])
    expect(screen.queryByRole("button", { name: tab, exact: true })).toBeNull();
  expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
  expect(screen.getByText(/recorded in an audit trail/)).toBeTruthy();
});

it("keeps every field, label and security attribute of the sign-in form", async () => {
  render(<FarmerRegistry client={signedOut()} />);
  const login = await screen.findByLabelText("Account name");
  const password = screen.getByLabelText("Password");
  const otp = screen.getByLabelText("Authenticator code");
  const device = screen.getByLabelText("Approved device ID");
  expect(login.getAttribute("autocomplete")).toBe("username");
  expect(password.getAttribute("type")).toBe("password");
  expect(password.getAttribute("autocomplete")).toBe("current-password");
  expect(otp.getAttribute("autocomplete")).toBe("one-time-code");
  expect(otp.getAttribute("inputmode")).toBe("numeric");
  expect(otp.getAttribute("pattern")).toBe("[0-9]{6}");
  expect(otp.getAttribute("maxlength")).toBe("6");
  expect(device.getAttribute("autocomplete")).toBe("off");
  for (const field of [login, password, otp, device])
    expect((field as HTMLInputElement).required).toBe(true);
});

it("describes the authenticator and device fields with hints a screen reader announces", async () => {
  render(<FarmerRegistry client={signedOut()} />);
  const otp = await screen.findByLabelText("Authenticator code");
  const device = screen.getByLabelText("Approved device ID");
  const text = (field: HTMLElement) =>
    field
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
  expect(text(otp)).toContain("6 digits");
  expect(text(device)).toContain("administrator");
});

it("offers one primary action and keeps device request and session re-check as separate, non-submitting buttons", async () => {
  const api = signedOut();
  render(<FarmerRegistry client={api} />);
  const signIn = await screen.findByRole("button", { name: "Sign in" });
  expect(signIn.getAttribute("type")).toBe("submit");
  expect(signIn.className).toContain("agri-btn--primary");
  const prepare = screen.getByRole("button", {
    name: "Download device enrollment request",
  });
  expect(prepare.getAttribute("type")).toBe("button");
  const recheck = screen.getByRole("button", {
    name: "Check session and refresh",
  });
  const calls = vi.mocked(api.context).mock.calls.length;
  await userEvent.click(recheck);
  await waitFor(() =>
    expect(vi.mocked(api.context).mock.calls.length).toBeGreaterThan(calls),
  );
});

it("switches to Sinhala with accessible language names and keeps the form usable", async () => {
  render(<FarmerRegistry client={signedOut()} />);
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Sign in" });
  expect(
    screen
      .getByRole("button", { name: "English", exact: true })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await user.click(screen.getByRole("button", { name: "සිංහල", exact: true }));
  expect(await screen.findByRole("heading", { name: "පුරන්න" })).toBeTruthy();
  expect(screen.getByLabelText("මුරපදය")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "සිංහල", exact: true })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
