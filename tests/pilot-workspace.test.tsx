import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PilotWorkspace } from "../apps/field-pwa/components/pilot-workspace";
import {
  PilotClient,
  PilotRequestError,
} from "../apps/field-pwa/lib/pilot-client";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const geography = {
  id: "4e743f19-e3f7-4ed0-bdcc-29fe8e71ff0d",
  label: "Synthetic village",
};
function client() {
  const client = new PilotClient();
  vi.spyOn(client, "context").mockResolvedValue({
    accountId,
    deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86",
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: Date.now(),
    offlineUntil: Date.now() + 3600000,
    geographies: [geography],
  });
  vi.spyOn(client, "register").mockResolvedValue();
  vi.spyOn(client, "login").mockResolvedValue();
  vi.spyOn(client, "logout").mockResolvedValue();
  return client;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});
it("routes authenticated registrations to durable encrypted storage and signs out without mounting a volatile form", async () => {
  const api = client();
  const storage = vi.spyOn(Storage.prototype, "setItem");
  render(<PilotWorkspace language="en" client={api} />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Sign out" });
  expect(
    screen
      .getByRole("link", { name: "Open encrypted offline workspace" })
      .getAttribute("href"),
  ).toBe("/offline-workspace");
  expect(screen.queryByLabelText("Full name")).toBeNull();
  expect(api.register).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByLabelText("Password")).toBeTruthy();
  expect(api.logout).toHaveBeenCalledOnce();
});
it("shows Sinhala sign-in and clears password and OTP after a failed attempt", async () => {
  const api = client();
  vi.mocked(api.context).mockRejectedValue(new PilotRequestError(401));
  vi.mocked(api.login).mockRejectedValue(new PilotRequestError(401));
  render(<PilotWorkspace language="si" client={api} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("ගිණුම් නාමය"), "synthetic");
  await user.type(screen.getByLabelText("මුරපදය"), "synthetic-test-password");
  await user.type(screen.getByLabelText("සත්‍යාපක කේතය"), "123456");
  await user.type(screen.getByLabelText("අනුමත උපාංග හැඳුනුම් අංකය"), geography.id);
  await user.click(screen.getByRole("button", { name: "පුරන්න" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect((screen.getByLabelText("මුරපදය") as HTMLInputElement).value).toBe("");
  expect(
    (screen.getByLabelText("සත්‍යාපක කේතය") as HTMLInputElement).value,
  ).toBe("");
  expect(screen.queryByLabelText("සම්පූර්ණ නම")).toBeNull();
});

it("prepares a public device request before sign-in and displays its independent verification code", async () => {
  const api = client();
  vi.mocked(api.context).mockRejectedValue(new PilotRequestError(401));
  const fingerprint = "a".repeat(64);
  vi.spyOn(api, "prepareDevice").mockResolvedValue({
    version: 1,
    origin: "https://field.example.test",
    deviceId: geography.id,
    publicKey: {
      kty: "EC",
      crv: "P-256",
      x: "A".repeat(43),
      y: "B".repeat(43),
    },
    fingerprint,
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const original = URL;
  vi.stubGlobal(
    "URL",
    class extends original {
      static createObjectURL = vi.fn(() => "blob:synthetic");
      static revokeObjectURL = vi.fn();
    },
  );
  render(<PilotWorkspace language="en" client={api} />);
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("Approved device ID"),
    geography.id,
  );
  await user.click(
    screen.getByRole("button", { name: "Download device enrollment request" }),
  );
  expect(await screen.findByText(fingerprint)).toBeTruthy();
  expect(api.prepareDevice).toHaveBeenCalledWith(geography.id);
  expect(api.login).not.toHaveBeenCalled();
  expect(click).toHaveBeenCalledOnce();
});
