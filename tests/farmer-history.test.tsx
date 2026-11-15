import { afterEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import * as protectedQueries from "../apps/admin-web/lib/protected-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmerHistory } from "../apps/admin-web/components/farmer-history";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
import type { FarmerHistoryPage } from "../packages/validation/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  farmerId = "06149451-4004-4a23-a5a2-64a24e485a82";
const eventId = "1d1ebede-c4a3-4d34-a6f5-5962cc403d0b",
  time = "2026-11-15T12:00:00.123457Z";
const page: FarmerHistoryPage = {
  accountId,
  farmerId,
  items: [
    {
      eventId,
      actorAccountId: accountId,
      occurredAt: time,
      action: "correction",
      change: {
        reason: "Synthetic correction reason",
        previousVersion: 1,
        resultVersion: 2,
        duplicateRisk: false,
        previous: {
          fullName: "Synthetic prior name",
          geographyId: accountId,
          geographyName: "Synthetic village",
          status: "pending-review",
        },
        result: {
          fullName: "Synthetic corrected name",
          geographyId: accountId,
          geographyName: "Synthetic village",
          status: "pending-review",
        },
      },
    },
  ],
  nextCursor: { beforeTime: time, beforeId: eventId },
};
function setup() {
  const client = new PilotClient();
  vi.spyOn(client, "farmerHistory").mockResolvedValue(page);
  return client;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("renders authorized before/after snapshots in both languages without persisting them", async () => {
  const client = setup(),
    storage = vi.spyOn(Storage.prototype, "setItem");
  const { rerender } = render(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={farmerId}
      language="en"
    />,
  );
  await screen.findByText("Synthetic correction reason", { exact: false });
  expect(screen.getByText(/Synthetic prior name/)).toBeTruthy();
  expect(screen.getByText(/Synthetic corrected name/)).toBeTruthy();
  rerender(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={farmerId}
      language="si"
    />,
  );
  expect(screen.getByRole("heading", { name: "වාර්තා ඉතිහාසය" })).toBeTruthy();
  expect(storage).not.toHaveBeenCalled();
  expect(client.farmerHistory).toHaveBeenCalledOnce();
});
it("passes an exact microsecond cursor and clears old history before a rejected next page", async () => {
  const client = setup(),
    onFailure = vi.fn();
  vi.mocked(client.farmerHistory)
    .mockResolvedValueOnce(page)
    .mockRejectedValueOnce(new PilotRequestError(403));
  render(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={farmerId}
      language="en"
      onFailure={onFailure}
    />,
  );
  await screen.findByText(/Synthetic prior name/);
  await userEvent.click(screen.getByRole("button", { name: "Older events" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(/Synthetic prior name/)).toBeNull();
  expect(client.farmerHistory).toHaveBeenLastCalledWith(
    farmerId,
    page.nextCursor,
    expect.any(AbortSignal),
  );
  expect(onFailure).toHaveBeenCalledOnce();
});
it("does not display a history response from a changed account", async () => {
  const client = setup();
  vi.mocked(client.farmerHistory).mockResolvedValue({
    ...page,
    accountId: farmerId,
  });
  render(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={farmerId}
      language="en"
    />,
  );
  await screen.findByRole("alert");
  expect(screen.queryByText(/Synthetic prior name/)).toBeNull();
});
it("ignores late history after selecting another farmer", async () => {
  const client = setup();
  let finish!: (value: FarmerHistoryPage) => void;
  vi.mocked(client.farmerHistory)
    .mockReturnValueOnce(
      new Promise((done) => {
        finish = done;
      }),
    )
    .mockResolvedValueOnce({
      accountId,
      farmerId: accountId,
      items: [],
      nextCursor: null,
    });
  const { rerender } = render(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={farmerId}
      language="en"
    />,
  );
  rerender(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={accountId}
      language="en"
    />,
  );
  await screen.findByText(
    "No history is available within your current audit permissions.",
  );
  finish(page);
  await waitFor(() =>
    expect(screen.queryByText(/Synthetic prior name/)).toBeNull(),
  );
});

it("aborts and clears the old cache across authorization epochs, ignoring a late same-account response", async () => {
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  const client = setup();
  let finish!: (value: FarmerHistoryPage) => void;
  vi.mocked(client.farmerHistory)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValueOnce({ ...page, items: [], nextCursor: null });
  const { rerender, unmount } = render(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={farmerId}
      language="en"
      authorizationEpoch={1}
    />,
  );
  await waitFor(() => expect(client.farmerHistory).toHaveBeenCalledOnce());
  const firstCache = factory.mock.results[0].value;
  const signal = vi.mocked(client.farmerHistory).mock.calls[0][2]!;
  rerender(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={farmerId}
      language="en"
      authorizationEpoch={2}
    />,
  );
  expect(signal.aborted).toBe(true);
  expect(firstCache.getQueryCache().getAll()).toHaveLength(0);
  await screen.findByText(
    "No history is available within your current audit permissions.",
  );
  finish(page);
  await waitFor(() =>
    expect(screen.queryByText(/Synthetic prior name/)).toBeNull(),
  );
  expect(firstCache.getQueryCache().getAll()).toHaveLength(0);
  const currentCache = factory.mock.results[1].value;
  expect(currentCache.getQueryCache().getAll()[0].queryKey).toEqual(
    protectedQueries.farmerHistoryKey(accountId, 2, 0, farmerId),
  );
  unmount();
  expect(currentCache.getQueryCache().getAll()).toHaveLength(0);
});
it("rechecks latest-page authority and removes the former successful snapshot on denial", async () => {
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  const client = setup();
  vi.mocked(client.farmerHistory)
    .mockResolvedValueOnce(page)
    .mockRejectedValueOnce(new PilotRequestError(403));
  render(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={farmerId}
      language="en"
    />,
  );
  await screen.findByText(/Synthetic prior name/);
  await userEvent.click(screen.getByRole("button", { name: "Latest events" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(/Synthetic prior name/)).toBeNull();
  await waitFor(() =>
    expect(
      factory.mock.results[0].value
        .getQueryCache()
        .getAll()
        .every((query) => query.state.data === undefined),
    ).toBe(true),
  );
  expect(client.farmerHistory).toHaveBeenCalledTimes(2);
});
it("handles React strict lifecycle replay without persisting or restoring cancelled data", async () => {
  const factory = vi.spyOn(protectedQueries, "createProtectedQueryClient");
  const client = setup();
  const { unmount } = render(
    <StrictMode>
      <FarmerHistory
        client={client}
        accountId={accountId}
        farmerId={farmerId}
        language="en"
      />
    </StrictMode>,
  );
  await screen.findByText(/Synthetic prior name/);
  const signals = vi
    .mocked(client.farmerHistory)
    .mock.calls.map((call) => call[2]!);
  unmount();
  // Pending work is aborted; a completed request need not have its signal aborted.
  expect(signals.some((signal) => signal.aborted)).toBe(true);
  expect(
    factory.mock.results.every(
      (result) => result.value.getQueryCache().getAll().length === 0,
    ),
  ).toBe(true);
});
it("isolates account transitions even for the same farmer and rejects a former-account result", async () => {
  const client = setup();
  const { rerender } = render(
    <FarmerHistory
      client={client}
      accountId={accountId}
      farmerId={farmerId}
      language="en"
    />,
  );
  await screen.findByText(/Synthetic prior name/);
  rerender(
    <FarmerHistory
      client={client}
      accountId={farmerId}
      farmerId={farmerId}
      language="en"
    />,
  );
  expect(screen.queryByText(/Synthetic prior name/)).toBeNull();
  await screen.findByRole("alert");
  expect(screen.queryByText(/Synthetic prior name/)).toBeNull();
});

it("forwards cancellation through the typed history transport to fetch", async () => {
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
  const request = new PilotClient(fetcher).farmerHistory(
    farmerId,
    undefined,
    controller.signal,
  );
  const assertion = expect(request).rejects.toMatchObject({ status: 503 });
  controller.abort();
  await assertion;
  expect(sent.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
});
