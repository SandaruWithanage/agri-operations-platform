import { afterEach, expect, it, vi } from "vitest";
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
