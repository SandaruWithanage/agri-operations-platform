import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
async function fill() {
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("Full name"),
    "Synthetic farmer",
  );
  await user.selectOptions(
    screen.getByLabelText("GN division or village"),
    geography.id,
  );
  await user.click(
    screen.getByLabelText("I provided the required privacy notice"),
  );
  return user;
}
it("mounts authorized locations, protects unsaved entries, and retries the identical registration", async () => {
  const api = client();
  vi.mocked(api.register).mockRejectedValueOnce(new PilotRequestError(503));
  const storage = vi.spyOn(Storage.prototype, "setItem");
  render(<PilotWorkspace language="en" client={api} />);
  const user = await fill();
  expect(
    (screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save registration" }));
  expect(
    await screen.findByText(/request could not be confirmed/),
  ).toBeTruthy();
  expect(
    (screen.getByLabelText("Full name") as HTMLInputElement).disabled,
  ).toBe(true);
  expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe(
    "Synthetic farmer",
  );
  await user.click(screen.getByRole("button", { name: "Save registration" }));
  expect(
    await screen.findByText("Synced. Registration saved on the server."),
  ).toBeTruthy();
  expect(api.register).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.register).mock.calls[0]).toEqual(
    vi.mocked(api.register).mock.calls[1],
  );
  expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe(
    "",
  );
  expect(storage).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByLabelText("Password")).toBeTruthy();
  expect(api.logout).toHaveBeenCalledOnce();
});
it("retains a failed registration across reauthentication and rejects a different account", async () => {
  const api = client();
  vi.mocked(api.register).mockRejectedValueOnce(new PilotRequestError(401));
  render(<PilotWorkspace language="en" client={api} />);
  const user = await fill();
  await user.click(screen.getByRole("button", { name: "Save registration" }));
  expect(await screen.findByLabelText("Password")).toBeTruthy();
  vi.mocked(api.context).mockResolvedValueOnce({
    accountId: geography.id,
    geographies: [geography],
  });
  await user.click(screen.getByRole("button", { name: "Check session again" }));
  expect(await screen.findByText(/Action denied/)).toBeTruthy();
  expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe(
    "Synthetic farmer",
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Save registration",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.type(screen.getByLabelText("Account name"), "synthetic");
  await user.type(screen.getByLabelText("Password"), "synthetic-test-password");
  await user.type(screen.getByLabelText("Authenticator code"), "123456");
  await user.type(screen.getByLabelText("Approved device ID"), geography.id);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(screen.queryByLabelText("Password")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Save registration" }));
  expect(
    await screen.findByText("Synced. Registration saved on the server."),
  ).toBeTruthy();
  expect(vi.mocked(api.register).mock.calls[0]).toEqual(
    vi.mocked(api.register).mock.calls[1],
  );
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
