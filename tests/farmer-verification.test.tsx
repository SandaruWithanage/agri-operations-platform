import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { createProtectedQueryClient } from "../apps/admin-web/lib/protected-query";
import {
  FarmerVerification,
  verificationReviewReason,
} from "../apps/admin-web/components/farmer-verification";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  farmerId = "06149451-4004-4a23-a5a2-64a24e485a82";
function setup() {
  const client = new PilotClient(),
    onRefresh = vi.fn(),
    onFailure = vi.fn();
  vi.spyOn(client, "changeFarmer").mockResolvedValue({
    farmerId,
    version: 2,
    replayed: false,
    duplicateRisk: false,
  });
  vi.spyOn(client, "farmerVerificationReceipt").mockResolvedValue({
    accountId,
    farmerId,
    receipt: null,
  });
  return {
    client,
    onRefresh,
    onFailure,
    accountId,
    farmerId,
    version: 1,
    status: "pending-review",
    authorizationEpoch: 1,
    language: "en" as const,
  };
}
function view(props: ReturnType<typeof setup>) {
  const queries = createProtectedQueryClient();
  return {
    queries,
    ...render(
      <QueryClientProvider client={queries}>
        <FarmerVerification {...props} />
      </QueryClientProvider>,
    ),
  };
}
async function confirm() {
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm record review" }),
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});
it("requires explicit review and submits the current version with a fixed reason without persistence", async () => {
  const props = setup(),
    storage = vi.spyOn(Storage.prototype, "setItem");
  view(props);
  expect(
    (
      screen.getByRole("button", {
        name: "Confirm record review",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(props.client.farmerVerificationReceipt).not.toHaveBeenCalled();
  await confirm();
  await waitFor(() => expect(props.onRefresh).toHaveBeenCalledOnce());
  expect(props.client.changeFarmer).toHaveBeenCalledWith(accountId, {
    mutationId: expect.any(String),
    farmerId,
    expectedVersion: 1,
    action: "verification",
    reason: verificationReviewReason,
  });
  expect(storage).not.toHaveBeenCalled();
});
it("retries an uncertain outcome with the identical immutable mutation and warns on unload", async () => {
  const props = setup();
  vi.mocked(props.client.changeFarmer)
    .mockRejectedValueOnce(new PilotRequestError(503))
    .mockResolvedValueOnce({
      farmerId,
      version: 2,
      replayed: true,
      duplicateRisk: false,
    });
  view(props);
  await confirm();
  await screen.findByRole("alert");
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: "Retry the same verification" }),
  );
  await waitFor(() => expect(props.onRefresh).toHaveBeenCalledOnce());
  expect(vi.mocked(props.client.changeFarmer).mock.calls[0]).toEqual(
    vi.mocked(props.client.changeFarmer).mock.calls[1],
  );
});
it("does not automatically retry a stale version and requires a fresh review", async () => {
  const props = setup();
  vi.mocked(props.client.changeFarmer).mockRejectedValue(
    new PilotRequestError(409),
  );
  view(props);
  await confirm();
  await screen.findByText(/The record changed/);
  expect(
    screen.queryByRole("button", { name: "Retry the same verification" }),
  ).toBeNull();
  expect(props.client.changeFarmer).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Refresh record" }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
});
it("reports revoked permission to the protected parent", async () => {
  const props = setup();
  vi.mocked(props.client.changeFarmer).mockRejectedValue(
    new PilotRequestError(403),
  );
  view(props);
  await confirm();
  await waitFor(() => expect(props.onFailure).toHaveBeenCalledOnce());
  expect(props.onRefresh).not.toHaveBeenCalled();
});
it("does not restore a view when an acknowledgement arrives after unmount", async () => {
  const props = setup();
  let finish!: (value: {
    farmerId: string;
    version: number;
    replayed: boolean;
    duplicateRisk: boolean;
  }) => void;
  vi.mocked(props.client.changeFarmer).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { unmount, queries } = view(props);
  await confirm();
  await screen.findByText("Saving review…");
  unmount();
  queries.clear();
  finish({ farmerId, version: 2, replayed: false, duplicateRisk: false });
  await waitFor(() =>
    expect(queries.getMutationCache().getAll()).toHaveLength(0),
  );
  expect(props.onRefresh).not.toHaveBeenCalled();
});
it("loads only the requesting account's latest receipt after an explicit request", async () => {
  const props = setup();
  props.status = "verified";
  vi.mocked(props.client.farmerVerificationReceipt).mockResolvedValue({
    accountId,
    farmerId,
    receipt: {
      mutationId: farmerId,
      version: 2,
      occurredAt: "2026-11-15T20:00:00.123456Z",
    },
  });
  view(props);
  expect(screen.queryByRole("checkbox")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Check my latest verification receipt",
    }),
  );
  await screen.findByText("Your latest visible verification");
  expect(screen.getByText("2")).toBeTruthy();
  expect(props.client.changeFarmer).not.toHaveBeenCalled();
});
it("rejects a receipt from another account", async () => {
  const props = setup();
  vi.mocked(props.client.farmerVerificationReceipt).mockResolvedValue({
    accountId: farmerId,
    farmerId,
    receipt: null,
  });
  view(props);
  await userEvent.click(
    screen.getByRole("button", {
      name: "Check my latest verification receipt",
    }),
  );
  await waitFor(() => expect(props.onFailure).toHaveBeenCalledOnce());
  expect(screen.queryByText("Your latest visible verification")).toBeNull();
});

it("keeps an uncertain intent fixed when language changes", async () => {
  const props = setup();
  vi.mocked(props.client.changeFarmer).mockRejectedValue(
    new PilotRequestError(503),
  );
  const { rerender, queries } = view(props);
  await confirm();
  await screen.findByRole("alert");
  rerender(
    <QueryClientProvider client={queries}>
      <FarmerVerification {...props} language="si" />
    </QueryClientProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "එම තහවුරු කිරීම නැවත උත්සාහ කරන්න" }),
  );
  await waitFor(() =>
    expect(props.client.changeFarmer).toHaveBeenCalledTimes(2),
  );
  expect(vi.mocked(props.client.changeFarmer).mock.calls[0]).toEqual(
    vi.mocked(props.client.changeFarmer).mock.calls[1],
  );
});

it("requires explicit verification retry instead of a paused online mutation resuming on reconnect", async () => {
  const props = setup();
  vi.mocked(props.client.changeFarmer).mockRejectedValue(
    new PilotRequestError(503),
  );
  view(props);
  onlineManager.setOnline(false);
  await confirm();
  await screen.findByRole("alert");
  expect(props.client.changeFarmer).toHaveBeenCalledOnce();
  onlineManager.setOnline(true);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Retry the same verification" }),
    ).toBeTruthy(),
  );
  expect(props.client.changeFarmer).toHaveBeenCalledOnce();
});
