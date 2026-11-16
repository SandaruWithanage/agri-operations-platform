import "fake-indexeddb/auto";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmerRegistrationEditor } from "../apps/admin-web/components/farmer-registration";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86",
  geography = {
    id: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
    label: "Synthetic village",
  };
function setup() {
  const client = new PilotClient();
  const identity = { accountId, deviceId };
  const context = {
    ...identity,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: 1,
    offlineUntil: 60001,
    geographies: [geography],
  };
  vi.spyOn(client, "sessionIdentity").mockResolvedValue(identity);
  vi.spyOn(client, "context").mockResolvedValue(context);
  vi.spyOn(client, "register").mockResolvedValue(undefined);
  let registered: (() => void) | undefined;
  const props = {
    draft: { id: 1, client, ...identity, boundaryEpoch: 0 },
    activeClient: client,
    boundaryEpoch: 0,
    language: "en" as "en" | "si",
    registerLock: (lock: () => void) => {
      registered = lock;
      return () => {
        if (registered === lock) registered = undefined;
      };
    },
    onSaved: vi.fn(),
    onDiscard: vi.fn(),
    onFailure: vi.fn(),
    onIdle: vi.fn(),
  };
  return { client, identity, context, props, lock: () => registered?.() };
}
async function fill() {
  await userEvent.type(
    await screen.findByLabelText("Full name"),
    "Synthetic administrator farmer",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("GN division or village"),
    geography.id,
  );
  await userEvent.click(
    screen.getByLabelText("I provided the required privacy notice"),
  );
}
async function submit() {
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Save registration",
      exact: true,
    }),
  );
}
async function reopen() {
  await userEvent.click(
    screen.getByRole("button", {
      name: "Check access and reopen registration",
    }),
  );
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  localStorage.clear();
});
it("submits only the minimal required data with fresh account/device binding and no browser persistence", async () => {
  const f = setup(),
    storage = vi.spyOn(Storage.prototype, "setItem"),
    database = vi.spyOn(indexedDB, "open");
  render(<FarmerRegistrationEditor {...f.props} />);
  await submit();
  expect(f.client.register).not.toHaveBeenCalled();
  await fill();
  await submit();
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(f.client.register).toHaveBeenCalledWith(
    accountId,
    {
      mutationId: expect.any(String),
      farmer: {
        farmerId: expect.any(String),
        fullName: "Synthetic administrator farmer",
        geographyId: geography.id,
        privacyNoticeProvided: true,
      },
    },
    deviceId,
  );
  expect(storage).not.toHaveBeenCalled();
  expect(database).not.toHaveBeenCalled();
});
it("retains fixed IDs and payload after an uncertain response, lock and locale change", async () => {
  const f = setup();
  vi.mocked(f.client.register).mockRejectedValueOnce(
    new PilotRequestError(503),
  );
  const view = render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  await submit();
  await screen.findByRole("alert");
  const original = vi.mocked(f.client.register).mock.calls[0][1];
  expect(
    (screen.getByLabelText("Full name") as HTMLInputElement).disabled,
  ).toBe(true);
  act(() => f.lock());
  expect(screen.queryByDisplayValue(original.farmer.fullName)).toBeNull();
  expect(unload()).toBe(true);
  await reopen();
  await screen.findByLabelText("Full name");
  view.rerender(<FarmerRegistrationEditor {...f.props} language="si" />);
  expect((screen.getByLabelText("සම්පූර්ණ නම") as HTMLInputElement).value).toBe(
    original.farmer.fullName,
  );
  expect((screen.getByLabelText("සම්පූර්ණ නම") as HTMLInputElement).disabled).toBe(
    true,
  );
  await userEvent.click(screen.getByRole("button", { name: "ලියාපදිංචිය සුරකින්න" }));
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(vi.mocked(f.client.register).mock.calls[1][1]).toEqual(original);
});
it("retains incomplete unsent values through a protected lock", async () => {
  const f = setup();
  render(<FarmerRegistrationEditor {...f.props} />);
  await userEvent.type(
    await screen.findByLabelText("Full name"),
    "Synthetic unfinished",
  );
  act(() => f.lock());
  expect(unload()).toBe(true);
  await reopen();
  expect(
    ((await screen.findByLabelText("Full name")) as HTMLInputElement).value,
  ).toBe("Synthetic unfinished");
  expect(f.client.register).not.toHaveBeenCalled();
});
it.each(["accountId", "deviceId"] as const)(
  "hides retained values if the %s changes",
  async (key) => {
    const f = setup();
    render(<FarmerRegistrationEditor {...f.props} />);
    await fill();
    act(() => f.lock());
    vi.mocked(f.client.sessionIdentity).mockResolvedValue({
      ...f.identity,
      [key]: geography.id,
    });
    await reopen();
    await screen.findByRole("heading", { name: "Registration draft locked" });
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(f.client.register).not.toHaveBeenCalled();
    expect(unload()).toBe(true);
  },
);
it("locks a retained selected geography after create coverage is revoked", async () => {
  const f = setup();
  render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  act(() => f.lock());
  vi.mocked(f.client.context).mockResolvedValue({
    ...f.context,
    geographies: [],
  });
  await reopen();
  await waitFor(() =>
    expect(f.props.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403 }),
    ),
  );
  expect(screen.queryByLabelText("Full name")).toBeNull();
  expect(unload()).toBe(true);
});
it("does not restore private DOM or consume a late success after locking", async () => {
  const f = setup();
  let finish!: () => void;
  vi.mocked(f.client.register).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  await submit();
  act(() => f.lock());
  await act(async () => finish());
  expect(f.props.onSaved).not.toHaveBeenCalled();
  expect(unload()).toBe(true);
  await reopen();
  await screen.findByLabelText("Full name");
  await submit();
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(vi.mocked(f.client.register).mock.calls[1][1]).toEqual(
    vi.mocked(f.client.register).mock.calls[0][1],
  );
});
it("does not automatically submit when connectivity returns", async () => {
  const f = setup();
  vi.mocked(f.client.register).mockRejectedValue(new PilotRequestError(503));
  render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  act(() => onlineManager.setOnline(false));
  await submit();
  await screen.findByRole("alert");
  expect(f.client.register).toHaveBeenCalledOnce();
  await act(async () => onlineManager.setOnline(true));
  expect(f.client.register).toHaveBeenCalledOnce();
});
it("blocks another attempt after a conflict without changing the fixed request", async () => {
  const f = setup();
  vi.mocked(f.client.register).mockRejectedValue(new PilotRequestError(409));
  render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  await submit();
  await screen.findByText(/submission conflicts with an existing request/);
  expect(
    (
      screen.getByRole("button", {
        name: "Save registration",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(unload()).toBe(true);
});
it("locks on server denial and retains the submission", async () => {
  const f = setup();
  vi.mocked(f.client.register).mockRejectedValue(new PilotRequestError(403));
  render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  await submit();
  await screen.findByRole("heading", { name: "Registration draft locked" });
  expect(f.props.onFailure).toHaveBeenCalled();
  expect(unload()).toBe(true);
});
it("checks the original identity and requires explicit confirmation before discard", async () => {
  const f = setup(),
    confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  await userEvent.click(
    screen.getByRole("button", { name: "Discard registration draft" }),
  );
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(f.props.onDiscard).not.toHaveBeenCalled();
  expect(unload()).toBe(true);
  confirm.mockReturnValue(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Discard registration draft" }),
  );
  await waitFor(() => expect(f.props.onDiscard).toHaveBeenCalledOnce());
});
it("does not allow another account to discard or confirm", async () => {
  const f = setup(),
    confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  vi.mocked(f.client.sessionIdentity).mockResolvedValue({
    ...f.identity,
    accountId: geography.id,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Discard registration draft" }),
  );
  await waitFor(() => expect(f.props.onFailure).toHaveBeenCalled());
  expect(confirm).not.toHaveBeenCalled();
  expect(f.props.onDiscard).not.toHaveBeenCalled();
});
it("ignores a late discard identity after another lock", async () => {
  const f = setup(),
    confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  let finish!: (value: typeof f.identity) => void;
  render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  vi.mocked(f.client.sessionIdentity).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Discard registration draft" }),
  );
  act(() => f.lock());
  await act(async () => finish(f.identity));
  expect(confirm).not.toHaveBeenCalled();
  expect(f.props.onDiscard).not.toHaveBeenCalled();
});
it("locks on inactivity, visibility and transport changes while preserving values", async () => {
  const f = setup(),
    view = render(<FarmerRegistrationEditor {...f.props} />);
  await fill();
  view.rerender(<FarmerRegistrationEditor {...f.props} idleMs={50} />);
  await screen.findByRole("heading", { name: "Registration draft locked" });
  expect(f.props.onIdle).toHaveBeenCalled();
  await reopen();
  await screen.findByLabelText("Full name");
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(screen.queryByLabelText("Full name")).toBeNull();
  visibility.mockRestore();
  view.rerender(
    <FarmerRegistrationEditor {...f.props} activeClient={new PilotClient()} />,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Check access and reopen registration",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(unload()).toBe(true);
});
it("starts with no locations and never treats a role label as create permission", async () => {
  const f = setup();
  vi.mocked(f.client.context).mockResolvedValue({
    ...f.context,
    geographies: [],
  });
  render(
    <StrictMode>
      <FarmerRegistrationEditor {...f.props} />
    </StrictMode>,
  );
  await screen.findByText("No authorized locations are available.");
  expect(
    (
      screen.getByRole("button", {
        name: "Save registration",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(f.client.register).not.toHaveBeenCalled();
});
it("lets a create-only administrator register without reading or owning the new record", async () => {
  const f = setup();
  vi.spyOn(f.client, "farmers").mockRejectedValue(new PilotRequestError(403));
  const detail = vi.spyOn(f.client, "farmer");
  render(<FarmerRegistry client={f.client} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Register a farmer" }),
  );
  await fill();
  await submit();
  await screen.findByText(/Registration accepted for review/);
  expect(detail).not.toHaveBeenCalled();
  expect(f.client.register).toHaveBeenCalledOnce();
});
