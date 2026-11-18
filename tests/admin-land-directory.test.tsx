import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import * as protectedQueries from "../apps/admin-web/lib/protected-query";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
import type { LandPage } from "../packages/validation/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const land = {
  id: "06149451-4004-4a23-a5a2-64a24e485a82",
  geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  geographyName: "Synthetic configured village",
  label: "Synthetic reported land",
  point: { longitude: 0, latitude: 0, accuracyM: 0 },
  reportedAreaHectares: 0,
  createdAt: "2026-11-15T10:00:00.000Z",
  version: 1,
  identificationOnly: true as const,
};
function setup() {
  const client = new PilotClient();
  vi.spyOn(client, "context").mockResolvedValue({
    accountId,
    deviceId,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: Date.now(),
    offlineUntil: Date.now() + 3600000,
    geographies: [],
  });
  vi.spyOn(client, "farmers").mockResolvedValue({
    accountId,
    items: [],
    nextCursor: null,
  });
  vi.spyOn(client, "land").mockResolvedValue({
    accountId,
    items: [land],
    nextCursor: null,
  });
  vi.spyOn(client, "landIdentification").mockResolvedValue({ accountId, land });
  vi.spyOn(client, "logout").mockResolvedValue();
  return client;
}
async function open(client: PilotClient) {
  render(<FarmerRegistry client={client} />);
  // The record tabs appear once the session is loaded (not on the sign-in screen).
  const button = await screen.findByRole("button", {
    name: "Reported land",
    exact: true,
  });
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
  await userEvent.click(button);
}
async function detail() {
  await userEvent.click(
    await screen.findByRole("button", {
      name: `View land: ${land.label} (${land.id})`,
    }),
  );
  await screen.findByRole("button", { name: "Close land", exact: true });
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("loads land only after selection and shows authorized zero values without persistence", async () => {
  const client = setup(),
    storage = vi.spyOn(Storage.prototype, "setItem");
  render(<FarmerRegistry client={client} />);
  await screen.findByText(/No farmer records/);
  expect(client.land).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Reported land", exact: true }),
  );
  await screen.findByText(land.label);
  await detail();
  expect(screen.getAllByText("0")).toHaveLength(4);
  expect(screen.getByText(/do not establish ownership/)).toBeTruthy();
  expect(client.landIdentification).toHaveBeenCalledWith(
    land.id,
    expect.any(AbortSignal),
  );
  expect(storage).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "සිංහල", exact: true }),
  );
  expect(
    screen.getByRole("heading", { name: "වාර්තා කළ ඉඩම් ලේඛනය" }),
  ).toBeTruthy();
  expect(screen.getByText("අක්ෂාංශ")).toBeTruthy();
  expect(storage.mock.calls.every(([key]) => key === "agri-language")).toBe(
    true,
  );
});
it("distinguishes absent GPS, label and area from reported zero values", async () => {
  const client = setup();
  vi.mocked(client.landIdentification).mockResolvedValue({
    accountId,
    land: { ...land, label: null, point: null, reportedAreaHectares: null },
  });
  await open(client);
  await detail();
  expect(screen.getByRole("heading", { name: "Unlabelled land" })).toBeTruthy();
  expect(screen.getByText("GPS not recorded")).toBeTruthy();
  expect(screen.getByText("Not reported")).toBeTruthy();
  expect(screen.queryByText("Latitude")).toBeNull();
});
it("uses bounded cursor pages and clears the former page", async () => {
  const client = setup();
  vi.mocked(client.land)
    .mockResolvedValueOnce({ accountId, items: [land], nextCursor: land.id })
    .mockResolvedValueOnce({
      accountId,
      items: [{ ...land, id: accountId, label: "Synthetic second land" }],
      nextCursor: null,
    });
  await open(client);
  await screen.findByText(land.label);
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Synthetic second land");
  expect(screen.queryByText(land.label)).toBeNull();
  expect(client.land).toHaveBeenLastCalledWith(
    land.id,
    expect.any(AbortSignal),
  );
  await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
  expect(client.land).toHaveBeenLastCalledWith(
    undefined,
    expect.any(AbortSignal),
  );
});
it("rejects another account's land list", async () => {
  const client = setup();
  vi.mocked(client.land).mockResolvedValue({
    accountId: deviceId,
    items: [land],
    nextCursor: null,
  });
  await open(client);
  await screen.findByLabelText("Password");
  expect(screen.queryByText(land.label)).toBeNull();
});
it("clears coordinates and cached records after a revoked detail", async () => {
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  const client = setup();
  vi.mocked(client.landIdentification).mockRejectedValue(
    new PilotRequestError(404),
  );
  await open(client);
  await screen.findByText(land.label);
  await userEvent.click(
    screen.getByRole("button", {
      name: `View land: ${land.label} (${land.id})`,
    }),
  );
  await screen.findByText(
    "This land identification is not available within your current read permissions.",
  );
  expect(screen.queryByText(land.label)).toBeNull();
  expect(screen.queryByText("Latitude")).toBeNull();
  expect(
    factory.mock.results[0].value
      .getQueryCache()
      .getAll()
      .every((query) => query.state.data === undefined),
  ).toBe(true);
});
it("cancels pending land when returning to farmers and ignores a late result", async () => {
  const client = setup();
  let finish!: (page: LandPage) => void;
  vi.mocked(client.land).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await open(client);
  await waitFor(() => expect(client.land).toHaveBeenCalledOnce());
  const signal = vi.mocked(client.land).mock.calls[0][1]!;
  await userEvent.click(
    screen.getByRole("button", { name: "Farmers", exact: true }),
  );
  expect(signal.aborted).toBe(true);
  finish({ accountId, items: [land], nextCursor: null });
  await screen.findByText(/No farmer records/);
  expect(screen.queryByText(land.label)).toBeNull();
});
it("clears land detail on hiding and requires an explicit fresh read", async () => {
  const client = setup();
  await open(client);
  await detail();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.queryByText(land.label)).toBeNull();
  expect(screen.queryByText("Latitude")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Check session and refresh" }),
  );
  await screen.findByText(land.label);
  expect(client.land).toHaveBeenCalledTimes(2);
});
it("clears land coordinates on logout", async () => {
  const client = setup();
  await open(client);
  await detail();
  await userEvent.click(
    screen.getByRole("button", { name: "Sign out", exact: true }),
  );
  await screen.findByLabelText("Password");
  expect(screen.queryByText(land.label)).toBeNull();
  expect(screen.queryByText("Latitude")).toBeNull();
});

it("does not show a land detail returned for another account", async () => {
  const client = setup();
  vi.mocked(client.landIdentification).mockResolvedValue({
    accountId: deviceId,
    land,
  });
  await open(client);
  await screen.findByText(land.label);
  await userEvent.click(
    screen.getByRole("button", {
      name: `View land: ${land.label} (${land.id})`,
    }),
  );
  await screen.findByLabelText("Password");
  expect(screen.queryByText(land.label)).toBeNull();
  expect(screen.queryByText("Latitude")).toBeNull();
});
