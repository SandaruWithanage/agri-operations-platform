import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const farmer = {
  id: "06149451-4004-4a23-a5a2-64a24e485a82",
  fullName: "Synthetic admin visible",
  geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  geographyName: "Synthetic configured village",
  status: "pending-review" as const,
  createdAt: "2026-11-15T10:00:00.000Z",
  version: 1,
  duplicateRisk: false,
};
function client() {
  const api = new PilotClient();
  vi.spyOn(api, "context").mockResolvedValue({
    accountId,
    deviceId,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: Date.now(),
    offlineUntil: Date.now() + 3600000,
    geographies: [],
  });
  vi.spyOn(api, "farmers").mockResolvedValue({
    accountId,
    items: [farmer],
    nextCursor: null,
  });
  vi.spyOn(api, "farmer").mockResolvedValue({ accountId, farmer });
  vi.spyOn(api, "logout").mockResolvedValue();
  return api;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("renders configured records in both languages without persisting farmer data and loads an actor-bound detail", async () => {
  const api = client(),
    storage = vi.spyOn(Storage.prototype, "setItem");
  render(<FarmerRegistry client={api} />);
  await screen.findByText(farmer.fullName);
  expect(screen.getByText(farmer.geographyName)).toBeTruthy();
  expect(storage).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "සිංහල" }));
  expect(screen.getByRole("heading", { name: "ගොවි ලේඛනය" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "English" }));
  await user.click(
    screen.getByRole("button", { name: `View record: ${farmer.fullName}` }),
  );
  await screen.findByRole("heading", { name: farmer.fullName });
  expect(api.farmer).toHaveBeenCalledWith(farmer.id);
  expect(storage.mock.calls.every(([key]) => key === "agri-language")).toBe(
    true,
  );
});
it("clears private data on a rejected detail and leaves session recovery controls usable", async () => {
  const api = client();
  vi.mocked(api.farmer).mockRejectedValue(new PilotRequestError(401));
  render(<FarmerRegistry client={api} />);
  await screen.findByText(farmer.fullName);
  await userEvent.click(
    screen.getByRole("button", { name: `View record: ${farmer.fullName}` }),
  );
  await screen.findByLabelText("Password");
  expect(screen.queryByText(farmer.fullName)).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Check session and refresh",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
it("refuses a list from a different session actor", async () => {
  const api = client();
  vi.mocked(api.farmers).mockResolvedValue({
    accountId: deviceId,
    items: [farmer],
    nextCursor: null,
  });
  render(<FarmerRegistry client={api} />);
  await screen.findByLabelText("Password");
  expect(screen.queryByText(farmer.fullName)).toBeNull();
});
it("ignores a late detail response after private views are cleared on hiding", async () => {
  const api = client();
  let resolve!: (value: { accountId: string; farmer: typeof farmer }) => void;
  vi.mocked(api.farmer).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<FarmerRegistry client={api} />);
  await screen.findByText(farmer.fullName);
  await userEvent.click(
    screen.getByRole("button", { name: `View record: ${farmer.fullName}` }),
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  resolve({ accountId, farmer });
  await waitFor(() => expect(screen.queryByText(farmer.fullName)).toBeNull());
  expect(screen.queryByRole("heading", { name: farmer.fullName })).toBeNull();
});
it("clears password and OTP after failed login without disabling future attempts", async () => {
  const api = client();
  vi.mocked(api.context).mockRejectedValue(new PilotRequestError(401));
  vi.spyOn(api, "login").mockRejectedValue(new PilotRequestError(401));
  render(<FarmerRegistry client={api} />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Account name"), "synthetic");
  await user.type(screen.getByLabelText("Password"), "synthetic-passphrase");
  await user.type(screen.getByLabelText("Authenticator code"), "123456");
  await user.type(screen.getByLabelText("Approved device ID"), deviceId);
  await user.click(
    screen.getByRole("button", { name: "Sign in", exact: true }),
  );
  await waitFor(() => expect(api.login).toHaveBeenCalledOnce());
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
    "",
  );
  expect(
    (screen.getByLabelText("Authenticator code") as HTMLInputElement).value,
  ).toBe("");
  expect(
    (
      screen.getByRole("button", {
        name: "Sign in",
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

it("loads audit history only after the server capability and clears it when the view is hidden", async () => {
  const api = client();
  vi.mocked(api.farmer).mockResolvedValue({
    accountId,
    farmer,
    access: { viewAudit: true },
  });
  vi.spyOn(api, "farmerHistory").mockResolvedValue({
    accountId,
    farmerId: farmer.id,
    items: [
      {
        eventId: farmer.id,
        actorAccountId: accountId,
        occurredAt: "2026-11-15T10:00:00.123456Z",
        action: "registration",
        change: null,
      },
    ],
    nextCursor: null,
  });
  render(<FarmerRegistry client={api} />);
  await screen.findByText(farmer.fullName);
  await userEvent.click(
    screen.getByRole("button", { name: `View record: ${farmer.fullName}` }),
  );
  await screen.findByRole("button", { name: "Show record history" });
  expect(api.farmerHistory).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Show record history" }),
  );
  await screen.findByText(/Original field values were not captured/);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.queryByRole("heading", { name: "Record history" })).toBeNull();
  expect(screen.queryByText(farmer.fullName)).toBeNull();
});
