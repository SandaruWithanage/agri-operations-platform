import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createProtectedQueryClient } from "../apps/admin-web/lib/protected-query";
import { FarmerCorrectionReceipt } from "../apps/admin-web/components/farmer-correction-receipt";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  farmerId = "06149451-4004-4a23-a5a2-64a24e485a82";
const value = {
  accountId,
  farmerId,
  receipt: {
    mutationId: accountId,
    version: 3,
    occurredAt: "2026-11-16T00:00:00Z",
  },
};
function setup() {
  const client = new PilotClient();
  vi.spyOn(client, "farmerCorrectionReceipt").mockResolvedValue(value);
  return {
    client,
    accountId,
    farmerId,
    authorizationEpoch: 1,
    language: "en" as "en" | "si",
    onFailure: vi.fn(),
  };
}
function view(props: ReturnType<typeof setup>) {
  const queries = createProtectedQueryClient();
  const element = (p: typeof props) => (
    <QueryClientProvider client={queries}>
      <FarmerCorrectionReceipt {...p} />
    </QueryClientProvider>
  );
  return {
    ...render(element(props)),
    update: (p: typeof props) => element(p),
    queries,
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("loads only on request and displays a bilingual receipt without browser persistence", async () => {
  const props = setup(),
    storage = vi.spyOn(Storage.prototype, "setItem"),
    rendered = view(props);
  expect(props.client.farmerCorrectionReceipt).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button"));
  await screen.findByText("3");
  expect(screen.getByText(/missing receipt does not prove/)).toBeTruthy();
  rendered.rerender(rendered.update({ ...props, language: "si" }));
  expect(screen.getByText("ප්‍රතිඵල වාර්තා අනුවාදය")).toBeTruthy();
  expect(storage).not.toHaveBeenCalled();
});
it("clears the displayed receipt when authorization identity changes", async () => {
  const props = setup(),
    rendered = view(props);
  await userEvent.click(screen.getByRole("button"));
  await screen.findByText("3");
  rendered.rerender(rendered.update({ ...props, authorizationEpoch: 2 }));
  expect(screen.queryByText("3")).toBeNull();
  expect(props.client.farmerCorrectionReceipt).toHaveBeenCalledOnce();
});
it("rejects cross-account receipts without rendering a result", async () => {
  const props = setup();
  vi.mocked(props.client.farmerCorrectionReceipt).mockResolvedValue({
    ...value,
    accountId: farmerId,
  });
  view(props);
  await userEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(props.onFailure).toHaveBeenCalledOnce());
  expect(screen.queryByText("3")).toBeNull();
});
it.each([401, 403, 404])(
  "reports denied receipt reads (%s) to the protected-view boundary",
  async (status) => {
    const props = setup();
    vi.mocked(props.client.farmerCorrectionReceipt).mockRejectedValue(
      new PilotRequestError(status),
    );
    view(props);
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledOnce());
    expect(screen.queryByText("3")).toBeNull();
  },
);
it("cancels on unmount and ignores a late receipt", async () => {
  const props = setup();
  let finish!: (v: typeof value) => void, signal!: AbortSignal;
  vi.mocked(props.client.farmerCorrectionReceipt).mockImplementation(
    (_id, s) => {
      signal = s!;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  const rendered = view(props);
  await userEvent.click(screen.getByRole("button"));
  rendered.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish(value));
  expect(props.onFailure).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(rendered.queries.getQueryCache().getAll()).toHaveLength(0),
  );
});
it("reports an absent receipt without treating it as a successful edit", async () => {
  const props = setup();
  vi.mocked(props.client.farmerCorrectionReceipt).mockResolvedValue({
    ...value,
    receipt: null,
  });
  view(props);
  await userEvent.click(screen.getByRole("button"));
  await screen.findByText(/No correction receipt/);
  expect(screen.queryByText("3")).toBeNull();
});
