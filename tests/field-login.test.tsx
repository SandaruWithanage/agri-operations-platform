import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PilotWorkspace } from "../apps/field-pwa/components/pilot-workspace";
import {
  PilotClient,
  PilotRequestError,
} from "../apps/field-pwa/lib/pilot-client";

// Issue #71 (OWNER-D1): the field sign-in uses the shared layout. These tests pin
// what must not change (fields, names, security attributes, the always-reachable
// offline workspace) and what the redesign adds (the page frame and network state).
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
function signedOut() {
  const api = new PilotClient();
  vi.spyOn(api, "context").mockRejectedValue(new PilotRequestError(401));
  vi.spyOn(api, "logout").mockResolvedValue();
  return api;
}
function signedIn() {
  const api = new PilotClient();
  vi.spyOn(api, "context").mockResolvedValue({
    accountId,
    deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: Date.now(),
    offlineUntil: Date.now() + 3600000,
    geographies: [],
  });
  vi.spyOn(api, "logout").mockResolvedValue();
  return api;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("shows the sign-in page with one heading, the form, and the offline workspace link after it", async () => {
  render(
    <PilotWorkspace
      language="en"
      client={signedOut()}
      online={true}
      onLanguageChange={() => {}}
    />,
  );
  expect(
    await screen.findByRole("heading", { level: 1, name: "Sign in" }),
  ).toBeTruthy();
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(screen.getByRole("main").id).toBe("agri-auth-main");
  const offline = screen.getByRole("link", {
    name: "Open encrypted offline workspace",
  });
  expect(offline.getAttribute("href")).toBe("/offline-workspace");
  expect(
    screen
      .getByRole("link", { name: "Survey a land perimeter (online)" })
      .getAttribute("href"),
  ).toBe("/land-survey");
  // Sign-in first, task links after it, retry still available for session recovery.
  // The heading and layout appear while the session is checked; the form follows.
  const password = await screen.findByLabelText("Password");
  expect(
    Boolean(
      password.compareDocumentPosition(offline) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    ),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Check session again" }),
  ).toBeTruthy();
});

it("keeps every field, label and security attribute of the field sign-in", async () => {
  render(<PilotWorkspace language="en" client={signedOut()} />);
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
  expect(device.getAttribute("autocomplete")).toBe("off");
  expect(device.getAttribute("pattern")).toMatch(/\[0-9a-fA-F\]\{8\}/);
  for (const field of [login, password, otp, device])
    expect((field as HTMLInputElement).required).toBe(true);
  expect(
    screen.getByRole("button", { name: "Sign in" }).getAttribute("type"),
  ).toBe("submit");
  expect(
    screen
      .getByRole("button", { name: "Download device enrollment request" })
      .getAttribute("type"),
  ).toBe("button");
});

it("describes the authenticator and device fields with hints", async () => {
  render(<PilotWorkspace language="en" client={signedOut()} />);
  const otp = await screen.findByLabelText("Authenticator code");
  const device = screen.getByLabelText("Approved device ID");
  const hint = (field: HTMLElement) =>
    document.getElementById(field.getAttribute("aria-describedby")!)
      ?.textContent;
  expect(hint(otp)).toContain("6 digits");
  expect(hint(device)).toContain("administrator");
});

it("shows the device's real connection state and omits it when unknown", async () => {
  const { rerender } = render(
    <PilotWorkspace language="en" client={signedOut()} online={false} />,
  );
  expect(await screen.findByText("Device is offline.")).toBeTruthy();
  expect(screen.getByText("Device is offline.").getAttribute("role")).toBe(
    "status",
  );
  rerender(<PilotWorkspace language="en" client={signedOut()} online={true} />);
  expect(
    await screen.findByText("Device reports a network connection."),
  ).toBeTruthy();
  rerender(<PilotWorkspace language="en" client={signedOut()} />);
  expect(screen.queryByText("Device is offline.")).toBeNull();
  expect(screen.queryByText("Device reports a network connection.")).toBeNull();
});

it("offers the language switch only when the page supplies a handler, with accessible names", async () => {
  const change = vi.fn();
  const { unmount } = render(
    <PilotWorkspace
      language="en"
      client={signedOut()}
      onLanguageChange={change}
    />,
  );
  await screen.findByRole("heading", { name: "Sign in" });
  await userEvent.click(
    screen.getByRole("button", { name: "සිංහල", exact: true }),
  );
  expect(change).toHaveBeenCalledWith("si");
  unmount();
  render(<PilotWorkspace language="en" client={signedOut()} />);
  await screen.findByRole("heading", { name: "Sign in" });
  expect(
    screen.queryByRole("button", { name: "සිංහල", exact: true }),
  ).toBeNull();
});

it("wraps the signed-in home in the page frame with title, language switch and network state", async () => {
  render(
    <PilotWorkspace
      language="en"
      client={signedIn()}
      online={true}
      onLanguageChange={() => {}}
    />,
  );
  await screen.findByRole("button", { name: "Sign out" });
  expect(
    screen.getByRole("heading", { level: 1, name: "Field officer workspace" }),
  ).toBeTruthy();
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "English", exact: true }),
  ).toBeTruthy();
  expect(screen.getByText("Device reports a network connection.")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Open encrypted offline workspace" })
      .getAttribute("href"),
  ).toBe("/offline-workspace");
});
