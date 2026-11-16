import "fake-indexeddb/auto";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as protectedQueries from "../apps/admin-web/lib/protected-query";
import {
  FarmerCorrection,
  correctionReviewReason,
} from "../apps/admin-web/components/farmer-correction";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const source = {
  id: "06149451-4004-4a23-a5a2-64a24e485a82",
  fullName: "Synthetic original",
  geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  version: 1,
};
const edited = "Synthetic corrected name";
function setup() {
  const client = new PilotClient();
  const identity = {
    accountId,
    deviceId,
  };
  vi.spyOn(client, "sessionIdentity").mockResolvedValue(identity);
  const current = {
    ...source,
    geographyName: "Synthetic village",
    createdAt: "2026-11-16T00:00:00Z",
    status: "pending-review" as const,
    duplicateRisk: false,
  };
  vi.spyOn(client, "farmer").mockResolvedValue({
    accountId,
    farmer: current,
    access: { correct: true, viewAudit: false },
  });
  vi.spyOn(client, "farmerCorrectionGeographies").mockResolvedValue({
    accountId,
    farmerId: source.id,
    farmerVersion: 1,
    sourceGeographyId: source.geographyId,
    geographies: [{ id: source.geographyId, name: "Synthetic village" }],
    nextCursor: null,
  });
  vi.spyOn(client, "changeFarmer").mockResolvedValue({
    farmerId: source.id,
    version: 2,
    replayed: false,
    duplicateRisk: false,
  });
  let registered: (() => void) | undefined;
  const props = {
    draft: { id: 1, client, accountId, deviceId, source, boundaryEpoch: 0 },
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
  return { client, current, identity, props, lock: () => registered?.() };
}
async function changeName() {
  const input = await screen.findByLabelText("Corrected full name");
  await userEvent.clear(input);
  await userEvent.type(input, edited);
}
async function submit() {
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Save correction", exact: true }),
  );
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("requires current access and explicit review, submits the original version and fixed locale-independent reason", async () => {
  const f = setup(),
    storage = vi.spyOn(Storage.prototype, "setItem"),
    database = vi.spyOn(indexedDB, "open");
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  expect(
    (
      screen.getByRole("button", {
        name: "Save correction",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await submit();
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(f.client.changeFarmer).toHaveBeenCalledWith(
    accountId,
    {
      mutationId: expect.any(String),
      farmerId: source.id,
      expectedVersion: 1,
      action: "correction",
      fullName: edited,
      geographyId: source.geographyId,
      reason: correctionReviewReason,
    },
    deviceId,
  );
  expect(storage).not.toHaveBeenCalled();
  expect(database).not.toHaveBeenCalled();
});
it("preserves typed values and the review checkbox across language changes", async () => {
  const f = setup(),
    view = render(<FarmerCorrection {...f.props} />);
  await changeName();
  await userEvent.click(screen.getByRole("checkbox"));
  view.rerender(<FarmerCorrection {...f.props} language="si" />);
  expect(
    (screen.getByLabelText("නිවැරදි කළ සම්පූර්ණ නම") as HTMLInputElement).value,
  ).toBe(edited);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(f.client.sessionIdentity).toHaveBeenCalledOnce();
});
it("locks hidden values, clears fetched/mutation caches and reauthorizes before restoring the tab draft", async () => {
  const f = setup(),
    factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  expect(unload().defaultPrevented).toBe(true);
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.queryByLabelText("Corrected full name")).toBeNull();
  expect(screen.queryByText(edited)).toBeNull();
  visibility.mockReturnValue("visible");
  const queries = factory.mock.results[0].value;
  expect(
    queries
      .getQueryCache()
      .getAll()
      .every((q) => q.state.data === undefined),
  ).toBe(true);
  expect(queries.getMutationCache().getAll()).toHaveLength(0);
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen correction" }),
  );
  expect(
    ((await screen.findByLabelText("Corrected full name")) as HTMLInputElement)
      .value,
  ).toBe(edited);
  expect(f.client.sessionIdentity).toHaveBeenCalledTimes(2);
  expect(f.client.changeFarmer).not.toHaveBeenCalled();
});
it.each([
  { accountId: deviceId, deviceId },
  { accountId, deviceId: accountId },
])("does not restore values under another account/device", async (owner) => {
  const f = setup();
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  act(() => f.lock());
  vi.mocked(f.client.sessionIdentity).mockResolvedValue({
    ...f.identity,
    ...owner,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen correction" }),
  );
  await waitFor(() => expect(f.props.onFailure).toHaveBeenCalled());
  expect(screen.queryByLabelText("Corrected full name")).toBeNull();
  expect(f.client.changeFarmer).not.toHaveBeenCalled();
  vi.mocked(f.client.sessionIdentity).mockResolvedValue(f.identity);
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen correction" }),
  );
  expect(
    ((await screen.findByLabelText("Corrected full name")) as HTMLInputElement)
      .value,
  ).toBe(edited);
});
it("retains edited values after correction coverage is revoked", async () => {
  const f = setup();
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  act(() => f.lock());
  vi.mocked(f.client.farmerCorrectionGeographies).mockRejectedValueOnce(
    new PilotRequestError(403),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen correction" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Corrected full name")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen correction" }),
  );
  expect(
    ((await screen.findByLabelText("Corrected full name")) as HTMLInputElement)
      .value,
  ).toBe(edited);
});
it("retries a lost acknowledgement with the same immutable payload after locking and reopening", async () => {
  const f = setup();
  vi.mocked(f.client.changeFarmer)
    .mockRejectedValueOnce(new PilotRequestError(503))
    .mockResolvedValueOnce({
      farmerId: source.id,
      version: 2,
      replayed: true,
      duplicateRisk: false,
    });
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  await submit();
  await screen.findByRole("alert");
  const original = vi.mocked(f.client.changeFarmer).mock.calls[0];
  expect(unload().defaultPrevented).toBe(true);
  vi.mocked(f.client.farmer).mockResolvedValue({
    accountId,
    farmer: { ...f.current, version: 2 },
    access: { viewAudit: false, correct: true },
  });
  const acceptedPage = await f.client.farmerCorrectionGeographies(source.id);
  vi.mocked(f.client.farmerCorrectionGeographies).mockResolvedValue({
    ...acceptedPage,
    farmerVersion: 2,
  });
  act(() => f.lock());
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen correction" }),
  );
  await screen.findByRole("button", { name: "Retry the same correction" });
  expect(
    (screen.getByLabelText("Corrected full name") as HTMLInputElement).readOnly,
  ).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Retry the same correction" }),
  );
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(vi.mocked(f.client.changeFarmer).mock.calls[1]).toEqual(original);
});
it("never rebases a stale unsent draft or retries a known version conflict automatically", async () => {
  const f = setup();
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  act(() => f.lock());
  vi.mocked(f.client.farmer).mockResolvedValue({
    accountId,
    farmer: { ...f.current, version: 2 },
    access: { correct: true, viewAudit: false },
  });
  const page = await f.client.farmerCorrectionGeographies(source.id);
  vi.mocked(f.client.farmerCorrectionGeographies).mockResolvedValue({
    ...page,
    farmerVersion: 2,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen correction" }),
  );
  await screen.findByLabelText("Corrected full name");
  await userEvent.click(screen.getByRole("checkbox"));
  expect(
    (
      screen.getByRole("button", {
        name: "Save correction",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(f.client.changeFarmer).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText("Corrected full name") as HTMLInputElement).value,
  ).toBe(edited);
});
it("holds a 409 response for review without a replacement mutation", async () => {
  const f = setup();
  vi.mocked(f.client.changeFarmer).mockRejectedValue(
    new PilotRequestError(409),
  );
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  await submit();
  await screen.findByRole("alert");
  expect(f.client.changeFarmer).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", { name: "Retry the same correction" }),
  ).toBeNull();
  expect(f.props.onSaved).not.toHaveBeenCalled();
});
it("does not accept a late acknowledgement after the protected view is cleared", async () => {
  const f = setup();
  let finish!: (v: {
    farmerId: string;
    version: number;
    replayed: boolean;
    duplicateRisk: boolean;
  }) => void;
  vi.mocked(f.client.changeFarmer).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  await submit();
  act(() => f.lock());
  await act(async () =>
    finish({
      farmerId: source.id,
      version: 2,
      replayed: false,
      duplicateRisk: false,
    }),
  );
  expect(f.props.onSaved).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Corrected full name")).toBeNull();
  expect(unload().defaultPrevented).toBe(true);
});
it("requires original account/device confirmation before explicit discard and preserves a declined discard", async () => {
  const f = setup(),
    confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  await userEvent.click(
    screen.getByRole("button", { name: "Discard correction draft" }),
  );
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(f.props.onDiscard).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen correction" }),
  );
  expect(
    ((await screen.findByLabelText("Corrected full name")) as HTMLInputElement)
      .value,
  ).toBe(edited);
  confirm.mockReturnValue(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Discard correction draft" }),
  );
  await waitFor(() => expect(f.props.onDiscard).toHaveBeenCalledOnce());
});
it("will not discard a retained draft under another account", async () => {
  const f = setup(),
    confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  vi.mocked(f.client.sessionIdentity).mockResolvedValue({
    ...f.identity,
    accountId: deviceId,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Discard correction draft" }),
  );
  await waitFor(() => expect(f.props.onFailure).toHaveBeenCalled());
  expect(confirm).not.toHaveBeenCalled();
  expect(f.props.onDiscard).not.toHaveBeenCalled();
  expect(unload().defaultPrevented).toBe(true);
});
it("locks after inactivity while retaining unsent values", async () => {
  const f = setup();
  const view = render(<FarmerCorrection {...f.props} />);
  await changeName();
  view.rerender(<FarmerCorrection {...f.props} idleMs={100} />);
  await screen.findByRole("heading", { name: "Correction draft locked" });
  expect(f.props.onIdle).toHaveBeenCalled();
  expect(unload().defaultPrevented).toBe(true);
});
it("keeps values hidden through a transport change", async () => {
  const f = setup(),
    view = render(<FarmerCorrection {...f.props} />);
  await changeName();
  const other = new PilotClient();
  vi.spyOn(other, "sessionIdentity");
  view.rerender(<FarmerCorrection {...f.props} activeClient={other} />);
  await screen.findByRole("heading", { name: "Correction draft locked" });
  expect(screen.queryByLabelText("Corrected full name")).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Check access and reopen correction",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(other.sessionIdentity).not.toHaveBeenCalled();
});
it("opens safely in React Strict Mode", async () => {
  const f = setup();
  render(
    <StrictMode>
      <FarmerCorrection {...f.props} />
    </StrictMode>,
  );
  await screen.findByLabelText("Corrected full name");
  expect(f.props.onSaved).not.toHaveBeenCalled();
  expect(f.client.changeFarmer).not.toHaveBeenCalled();
});

it("cancels a pending discard identity check on a second lock and ignores its late result", async () => {
  const f = setup(),
    confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<FarmerCorrection {...f.props} />);
  await changeName();
  let finish!: (v: { accountId: string; deviceId: string }) => void;
  vi.mocked(f.client.sessionIdentity).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Discard correction draft" }),
  );
  act(() => f.lock());
  await act(async () => finish({ accountId, deviceId }));
  expect(confirm).not.toHaveBeenCalled();
  expect(f.props.onDiscard).not.toHaveBeenCalled();
  expect(f.props.onFailure).not.toHaveBeenCalled();
  expect(unload().defaultPrevented).toBe(true);
});
