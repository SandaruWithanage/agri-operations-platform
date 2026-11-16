import "fake-indexeddb/auto";
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
import { LandRegistrationEditor } from "../apps/admin-web/components/land-registration";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const geography = {
  id: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  name: "Synthetic authorized village",
};
function setup() {
  const client = new PilotClient(),
    identity = { accountId, deviceId };
  vi.spyOn(client, "sessionIdentity").mockResolvedValue(identity);
  vi.spyOn(client, "landGeographies").mockResolvedValue({
    accountId,
    geographies: [geography],
  });
  vi.spyOn(client, "registerLand").mockImplementation(
    async (_account, input) => ({
      status: "synced",
      landId: input.landId,
      replayed: false,
    }),
  );
  let lock: (() => void) | undefined;
  const props = {
    draft: { id: 1, client, ...identity, boundaryEpoch: 0 },
    activeClient: client,
    boundaryEpoch: 0,
    language: "en" as "en" | "si",
    registerLock: (value: () => void) => {
      lock = value;
      return () => {
        if (lock === value) lock = undefined;
      };
    },
    onSaved: vi.fn(),
    onDiscard: vi.fn(),
    onFailure: vi.fn(),
    onIdle: vi.fn(),
  };
  return { client, props, identity, lock: () => lock?.() };
}
async function location() {
  await userEvent.selectOptions(
    await screen.findByLabelText("GN division or village"),
    geography.id,
  );
}
async function save() {
  await userEvent.click(
    screen.getByRole("button", { name: "Save reported land", exact: true }),
  );
}
function gps() {
  vi.stubGlobal("isSecureContext", true);
  let success!: PositionCallback, failure!: PositionErrorCallback;
  const request = vi.fn((yes: PositionCallback, no: PositionErrorCallback) => {
    success = yes;
    failure = no;
  });
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: request } });
  return {
    request,
    success: (latitude = 8.3, longitude = 80.25, accuracy = 12) =>
      success({
        coords: { latitude, longitude, accuracy },
      } as GeolocationPosition),
    failure: () => failure({ code: 1 } as GeolocationPositionError),
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it("requires configured land coverage but no label, point, area or farmer relationship", async () => {
  const f = setup(),
    storage = vi.spyOn(Storage.prototype, "setItem"),
    database = vi.spyOn(indexedDB, "open");
  render(<LandRegistrationEditor {...f.props} />);
  await location();
  await save();
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(f.client.registerLand).toHaveBeenCalledWith(
    accountId,
    {
      mutationId: expect.any(String),
      landId: expect.any(String),
      geographyId: geography.id,
      label: null,
      point: null,
      reportedAreaHectares: null,
    },
    deviceId,
  );
  expect(storage).not.toHaveBeenCalled();
  expect(database).not.toHaveBeenCalled();
});
it("preserves zero coordinates/accuracy/area and fixes IDs through a lost acknowledgement, lock and Sinhala toggle", async () => {
  const f = setup();
  vi.mocked(f.client.registerLand).mockRejectedValueOnce(
    new PilotRequestError(503),
  );
  const view = render(<LandRegistrationEditor {...f.props} />);
  await location();
  for (const label of [
    "Latitude (optional)",
    "Longitude (optional)",
    "Reported accuracy in metres (optional)",
    "Reported area in hectares (optional)",
  ])
    await userEvent.type(screen.getByLabelText(label), "0");
  await save();
  await screen.findByText(/Could not confirm the land registration/);
  const sent = vi.mocked(f.client.registerLand).mock.calls[0][1];
  expect(sent.point).toEqual({ longitude: 0, latitude: 0, accuracyM: 0 });
  expect(sent.reportedAreaHectares).toBe(0);
  act(() => f.lock());
  expect(screen.queryByLabelText("Latitude (optional)")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen land" }),
  );
  await screen.findByLabelText("Latitude (optional)");
  view.rerender(<LandRegistrationEditor {...f.props} language="si" />);
  expect(
    (screen.getByLabelText("අක්ෂාංශ (විකල්ප)") as HTMLInputElement).value,
  ).toBe("0");
  expect(
    (screen.getByLabelText("අක්ෂාංශ (විකල්ප)") as HTMLInputElement).disabled,
  ).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: "වාර්තා කළ ඉඩම සුරකින්න" }),
  );
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(vi.mocked(f.client.registerLand).mock.calls[1][1]).toEqual(sent);
});
it.each([
  { "Latitude (optional)": "8.3" },
  { "Latitude (optional)": "91", "Longitude (optional)": "80" },
  { "Reported accuracy in metres (optional)": "12" },
  { "Reported area in hectares (optional)": "-1" },
  { "Reported area in hectares (optional)": "0.00001" },
])(
  "rejects invalid reported fields before issuing a mutation: %j",
  async (fields) => {
    const f = setup();
    render(<LandRegistrationEditor {...f.props} />);
    await location();
    for (const [label, value] of Object.entries(fields))
      await userEvent.type(screen.getByLabelText(label), value);
    await save();
    await screen.findByRole("alert");
    expect(f.client.registerLand).not.toHaveBeenCalled();
  },
);
it("requests fresh GPS only after an explicit action and reports valid accuracy without inferring area", async () => {
  const f = setup();
  render(<LandRegistrationEditor {...f.props} />);
  await location();
  const g = gps();
  expect(g.request).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Use current GPS location" }),
  );
  expect(g.request).toHaveBeenCalledWith(
    expect.any(Function),
    expect.any(Function),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
  act(() => g.success());
  expect(
    (screen.getByLabelText("Latitude (optional)") as HTMLInputElement).value,
  ).toBe("8.3");
  expect(
    (
      screen.getByLabelText(
        "Reported area in hectares (optional)",
      ) as HTMLInputElement
    ).value,
  ).toBe("");
  await save();
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(vi.mocked(f.client.registerLand).mock.calls[0][1].point).toEqual({
    latitude: 8.3,
    longitude: 80.25,
    accuracyM: 12,
  });
});
it.each(["cancel", "edit", "lock"] as const)(
  "ignores a late GPS callback after %s",
  async (action) => {
    const f = setup();
    render(<LandRegistrationEditor {...f.props} />);
    await location();
    const g = gps();
    await userEvent.click(
      screen.getByRole("button", { name: "Use current GPS location" }),
    );
    if (action === "cancel")
      await userEvent.click(
        screen.getByRole("button", { name: "Cancel GPS request" }),
      );
    if (action === "edit")
      fireEvent.change(screen.getByLabelText("Latitude (optional)"), {
        target: { value: "0" },
      });
    if (action === "lock") act(() => f.lock());
    act(() => g.success());
    if (action === "lock") {
      expect(screen.queryByLabelText("Latitude (optional)")).toBeNull();
      await userEvent.click(
        screen.getByRole("button", { name: "Check access and reopen land" }),
      );
    }
    expect(
      (
        (await screen.findByLabelText(
          "Latitude (optional)",
        )) as HTMLInputElement
      ).value,
    ).toBe(action === "edit" ? "0" : "");
  },
);
it.each(["denied", "invalid", "insecure"] as const)(
  "allows saving without GPS after %s location failure",
  async (kind) => {
    const f = setup();
    render(<LandRegistrationEditor {...f.props} />);
    await location();
    const g = gps();
    if (kind === "insecure") vi.stubGlobal("isSecureContext", false);
    await userEvent.click(
      screen.getByRole("button", { name: "Use current GPS location" }),
    );
    if (kind === "denied") act(() => g.failure());
    if (kind === "invalid") act(() => g.success(91));
    await screen.findByText(/Location could not be obtained/);
    await save();
    await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
    expect(vi.mocked(f.client.registerLand).mock.calls[0][1].point).toBeNull();
  },
);
it("refuses a reopened location after land-create coverage is revoked", async () => {
  const f = setup();
  render(<LandRegistrationEditor {...f.props} />);
  await location();
  act(() => f.lock());
  vi.mocked(f.client.landGeographies).mockResolvedValue({
    accountId,
    geographies: [],
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen land" }),
  );
  await waitFor(() =>
    expect(f.props.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403 }),
    ),
  );
  expect(screen.queryByLabelText("Latitude (optional)")).toBeNull();
  expect(f.client.registerLand).not.toHaveBeenCalled();
});
it("uses independent land-create choices and refreshes the land directory without inferring read permission", async () => {
  const f = setup();
  vi.spyOn(f.client, "context").mockResolvedValue({
    ...f.identity,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: 1,
    offlineUntil: 60001,
    geographies: [],
  });
  vi.spyOn(f.client, "farmers").mockResolvedValue({
    accountId,
    items: [],
    nextCursor: null,
  });
  vi.spyOn(f.client, "land").mockResolvedValue({
    accountId,
    items: [],
    nextCursor: null,
  });
  const detail = vi.spyOn(f.client, "landIdentification");
  render(<FarmerRegistry client={f.client} />);
  await screen.findByText(
    "No farmer records are available within your current read permissions.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Reported land", exact: true }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Record land identification" }),
  );
  await location();
  await save();
  await screen.findByText(/Land identification accepted/);
  await screen.findByRole("heading", {
    name: "Reported land directory",
    exact: true,
  });
  expect(detail).not.toHaveBeenCalled();
  expect(f.client.registerLand).toHaveBeenCalledOnce();
});
