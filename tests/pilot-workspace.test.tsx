import { afterEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import * as fieldQueries from "../apps/field-pwa/lib/online-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

it("cancels hidden session checks, clears cached context and ignores a late response", async () => {
  const api = client(),
    factory = vi.spyOn(fieldQueries, "createFieldQueryClient");
  const value = await api.context();
  vi.mocked(api.context).mockClear();
  let finish!: (input: typeof value) => void;
  vi.mocked(api.context).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<PilotWorkspace language="en" client={api} />);
  await waitFor(() => expect(api.context).toHaveBeenCalledOnce());
  const signal = vi.mocked(api.context).mock.calls[0][0]!;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(signal.aborted).toBe(true);
  finish(value);
  await screen.findByLabelText("Password");
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  expect(
    factory.mock.results[0].value
      .getQueryCache()
      .getAll()
      .every((query) => query.state.data === undefined),
  ).toBe(true);
});
it("keeps only account/device metadata in memory and empties it on logout", async () => {
  const api = client(),
    factory = vi.spyOn(fieldQueries, "createFieldQueryClient");
  render(<PilotWorkspace language="en" client={api} />);
  await screen.findByRole("button", { name: "Sign out" });
  const cache = factory.mock.results[0].value;
  expect(
    cache
      .getQueryCache()
      .getAll()
      .find((query) => query.state.data)?.state.data,
  ).toEqual({ accountId, deviceId: "38f0dbdd-85db-4c75-bced-066e8ea54b86" });
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByLabelText("Password");
  expect(
    cache
      .getQueryCache()
      .getAll()
      .every((query) => query.state.data === undefined),
  ).toBe(true);
});
it("rechecks a revoked session without reusing cached success or automatic retries", async () => {
  const api = client();
  render(<PilotWorkspace language="en" client={api} />);
  await screen.findByRole("button", { name: "Sign out" });
  vi.mocked(api.context).mockRejectedValue(new PilotRequestError(401));
  await userEvent.click(
    screen.getByRole("button", { name: "Check session again" }),
  );
  await screen.findByLabelText("Password");
  expect(api.context).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});
it("replaces the cache when the client changes and supports strict lifecycle replay", async () => {
  const first = client(),
    second = client(),
    factory = vi.spyOn(fieldQueries, "createFieldQueryClient");
  vi.mocked(second.context).mockRejectedValue(new PilotRequestError(401));
  const { rerender, unmount } = render(
    <StrictMode>
      <PilotWorkspace language="en" client={first} />
    </StrictMode>,
  );
  await screen.findByRole("button", { name: "Sign out" });
  rerender(
    <StrictMode>
      <PilotWorkspace language="en" client={second} />
    </StrictMode>,
  );
  await screen.findByLabelText("Password");
  unmount();
  expect(
    factory.mock.results.every(
      (result) => result.value.getQueryCache().getAll().length === 0,
    ),
  ).toBe(true);
});

// Issue #71 (owner direction OWNER-D1): the field home leads with the officer's
// tasks when signed in and with sign-in when signed out. The task links must stay
// reachable in every state so the encrypted offline workspace never depends on a
// session round trip.
const before = (first: Element, second: Element) =>
  Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

it("leads with the task links when signed in and keeps the notice last", async () => {
  render(<PilotWorkspace language="en" client={client()} />);
  const signOut = await screen.findByRole("button", { name: "Sign out" });
  const offline = screen.getByRole("link", {
    name: "Open encrypted offline workspace",
  });
  const survey = screen.getByRole("link", {
    name: "Survey a land perimeter (online)",
  });
  const notice = screen.getByText(/Sign in on your approved device/);
  expect(before(offline, signOut)).toBe(true);
  expect(before(survey, signOut)).toBe(true);
  expect(before(signOut, notice)).toBe(true);
});

it("leads with sign-in when signed out and still offers the task links after it", async () => {
  const api = client();
  render(<PilotWorkspace language="en" client={api} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  const password = await screen.findByLabelText("Password");
  const offline = screen.getByRole("link", {
    name: "Open encrypted offline workspace",
  });
  expect(offline.getAttribute("href")).toBe("/offline-workspace");
  expect(
    screen
      .getByRole("link", { name: "Survey a land perimeter (online)" })
      .getAttribute("href"),
  ).toBe("/land-survey");
  expect(before(password, offline)).toBe(true);
});

it("keeps the offline workspace link reachable while the session is still being checked", () => {
  const api = new PilotClient();
  vi.spyOn(api, "context").mockReturnValue(new Promise(() => {}));
  render(<PilotWorkspace language="en" client={api} />);
  expect(screen.getByText("Checking session…")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Open encrypted offline workspace" })
      .getAttribute("href"),
  ).toBe("/offline-workspace");
});
