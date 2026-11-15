import { StrictMode } from "react";
import * as protectedQueries from "../apps/admin-web/lib/protected-query";
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
  expect(api.farmers).toHaveBeenCalledOnce();
  await user.click(
    screen.getByRole("button", { name: `View record: ${farmer.fullName}` }),
  );
  await screen.findByRole("heading", { name: farmer.fullName });
  expect(api.farmer).toHaveBeenCalledWith(farmer.id, expect.any(AbortSignal));
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

it("cancels a pending list and empties protected caches on hiding before a late response", async () => {
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  const api = client();
  let finish!: (value: Awaited<ReturnType<PilotClient["farmers"]>>) => void;
  vi.mocked(api.farmers).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<FarmerRegistry client={api} />);
  await waitFor(() => expect(api.farmers).toHaveBeenCalledOnce());
  const signal = vi.mocked(api.farmers).mock.calls[0][1]!;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  expect(signal.aborted).toBe(true);
  finish({ accountId, items: [farmer], nextCursor: null });
  await waitFor(() => expect(screen.queryByText(farmer.fullName)).toBeNull());
  expect(
    factory.mock.results[0].value
      .getQueryCache()
      .getAll()
      .every((query) => query.state.data === undefined),
  ).toBe(true);
});
it("checks a changed account before populating the refreshed registry and clears all records on logout", async () => {
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  const api = client();
  render(<FarmerRegistry client={api} />);
  await screen.findByText(farmer.fullName);
  const context = await api.context();
  vi.mocked(api.context).mockResolvedValue({ ...context, accountId: deviceId });
  vi.mocked(api.farmers).mockResolvedValue({
    accountId: deviceId,
    items: [{ ...farmer, fullName: "Synthetic account B record" }],
    nextCursor: null,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Check session and refresh" }),
  );
  await screen.findByText("Synthetic account B record");
  expect(screen.queryByText(farmer.fullName)).toBeNull();
  const cache = factory.mock.results[0].value;
  expect(
    cache
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.data !== undefined)
      .every((query) => JSON.stringify(query.queryKey).includes(deviceId)),
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByLabelText("Password");
  expect(screen.queryByText("Synthetic account B record")).toBeNull();
  expect(
    cache
      .getQueryCache()
      .getAll()
      .every((query) => query.state.data === undefined),
  ).toBe(true);
});
it("clears a successful page when the same account loses read permission on refresh without retries", async () => {
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  const api = client();
  render(<FarmerRegistry client={api} />);
  await screen.findByText(farmer.fullName);
  vi.mocked(api.farmers).mockRejectedValue(new PilotRequestError(403));
  await userEvent.click(
    screen.getByRole("button", { name: "Check session and refresh" }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText(farmer.fullName)).toBeNull();
  expect(api.farmers).toHaveBeenCalledTimes(2);
  expect(
    factory.mock.results[0].value
      .getQueryCache()
      .getAll()
      .every((query) => query.state.data === undefined),
  ).toBe(true);
});
it("aborts pending session discovery on unmount and never starts its later record request", async () => {
  const api = client();
  const context = await api.context();
  vi.mocked(api.context).mockClear();
  let finish!: (value: typeof context) => void;
  vi.mocked(api.context).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { unmount } = render(<FarmerRegistry client={api} />);
  await waitFor(() => expect(api.context).toHaveBeenCalledOnce());
  const signal = vi.mocked(api.context).mock.calls[0][0]!;
  unmount();
  expect(signal.aborted).toBe(true);
  finish(context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.farmers).not.toHaveBeenCalled();
});
it("supports strict lifecycle replay and clears successful records on final unmount", async () => {
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  const api = client();
  const { unmount } = render(
    <StrictMode>
      <FarmerRegistry client={api} />
    </StrictMode>,
  );
  await screen.findByText(farmer.fullName);
  unmount();
  expect(
    factory.mock.results.every(
      (result) => result.value.getQueryCache().getAll().length === 0,
    ),
  ).toBe(true);
});

const reads: Array<
  [string, (api: PilotClient, signal: AbortSignal) => Promise<unknown>]
> = [
  ["session discovery", (api, signal) => api.context(signal)],
  ["registry page", (api, signal) => api.farmers(undefined, signal)],
  ["farmer detail", (api, signal) => api.farmer(farmer.id, signal)],
];
it.each(reads)(
  "forwards %s cancellation to the typed fetch transport",
  async (_name, read) => {
    let sent!: AbortSignal;
    const fetcher = vi
      .fn()
      .mockImplementation((_path: string, input: RequestInit) => {
        sent = input.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          sent.addEventListener("abort", () => reject(sent.reason), {
            once: true,
          });
        });
      });
    const controller = new AbortController();
    const pending = expect(
      read(new PilotClient(fetcher), controller.signal),
    ).rejects.toMatchObject({ status: 503 });
    controller.abort();
    await pending;
    expect(sent.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it("rejects a typed detail response belonging to a different farmer", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ accountId, farmer: { ...farmer, id: deviceId } }),
    );
  await expect(
    new PilotClient(fetcher).farmer(farmer.id),
  ).rejects.toMatchObject({ status: 503 });
});

it("replaces the complete protected boundary when the transport changes", async () => {
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  const first = client(),
    second = client();
  vi.mocked(second.farmers).mockResolvedValue({
    accountId,
    items: [],
    nextCursor: null,
  });
  const { rerender } = render(<FarmerRegistry client={first} />);
  await screen.findByText(farmer.fullName);
  const previous = factory.mock.results[0].value;
  rerender(<FarmerRegistry client={second} />);
  expect(screen.queryByText(farmer.fullName)).toBeNull();
  expect(previous.getQueryCache().getAll()).toHaveLength(0);
  await waitFor(() => expect(second.farmers).toHaveBeenCalledOnce());
});
it("does not restart a private read when login finishes after the view was hidden", async () => {
  const api = client();
  vi.mocked(api.context).mockRejectedValue(new PilotRequestError(401));
  let finish!: () => void;
  vi.spyOn(api, "login").mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
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
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  finish();
  await waitFor(() =>
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    ),
  );
  expect(api.context).toHaveBeenCalledOnce();
  expect(api.farmers).not.toHaveBeenCalled();
});

it("exposes verification only after a server capability and reloads the record after acknowledgement", async () => {
  const api = client();
  vi.mocked(api.farmer)
    .mockResolvedValueOnce({
      accountId,
      farmer,
      access: { viewAudit: false, verify: true },
    })
    .mockResolvedValueOnce({
      accountId,
      farmer: { ...farmer, version: 2, status: "verified" },
      access: { viewAudit: false, verify: true },
    });
  vi.spyOn(api, "changeFarmer").mockResolvedValue({
    farmerId: farmer.id,
    version: 2,
    replayed: false,
    duplicateRisk: false,
  });
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  render(<FarmerRegistry client={api} />);
  await screen.findByText(farmer.fullName);
  await userEvent.click(
    screen.getByRole("button", { name: `View record: ${farmer.fullName}` }),
  );
  await screen.findByText("Staff record review");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm record review" }),
  );
  await screen.findByText("Verified");
  expect(api.farmer).toHaveBeenCalledTimes(2);
  expect(
    factory.mock.results[0].value.getMutationCache().getAll(),
  ).toHaveLength(0);
  expect(
    screen.queryByRole("button", { name: "Confirm record review" }),
  ).toBeNull();
});
it("clears pending verification and ignores its late acknowledgement when the view is hidden", async () => {
  const api = client();
  vi.mocked(api.farmer).mockResolvedValue({
    accountId,
    farmer,
    access: { viewAudit: false, verify: true },
  });
  let finish!: (value: {
    farmerId: string;
    version: number;
    replayed: boolean;
    duplicateRisk: boolean;
  }) => void;
  vi.spyOn(api, "changeFarmer").mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  render(<FarmerRegistry client={api} />);
  await screen.findByText(farmer.fullName);
  await userEvent.click(
    screen.getByRole("button", { name: `View record: ${farmer.fullName}` }),
  );
  await screen.findByText("Staff record review");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm record review" }),
  );
  await screen.findByText("Saving review…");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  finish({
    farmerId: farmer.id,
    version: 2,
    replayed: false,
    duplicateRisk: false,
  });
  await waitFor(() =>
    expect(
      factory.mock.results[0].value.getMutationCache().getAll(),
    ).toHaveLength(0),
  );
  expect(api.farmer).toHaveBeenCalledOnce();
  expect(screen.queryByText(farmer.fullName)).toBeNull();
});
