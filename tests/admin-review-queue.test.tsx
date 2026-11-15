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
import { PilotClient } from "../packages/sync-client/src";
import type { FarmerPage } from "../packages/validation/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const farmer = {
  id: "06149451-4004-4a23-a5a2-64a24e485a82",
  fullName: "Synthetic all",
  geographyId: accountId,
  geographyName: "Synthetic village",
  status: "pending-review" as const,
  version: 1,
  duplicateRisk: false,
  createdAt: "2026-11-15T10:00:00.000Z",
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
  vi.spyOn(client, "farmers").mockImplementation(
    async (after, _signal, filters = {}) => ({
      accountId,
      ...(Object.keys(filters).length ? { filters } : {}),
      items: [
        {
          ...farmer,
          fullName: after
            ? "Synthetic next page"
            : `Synthetic ${filters.status ?? "all"}`,
          status: filters.status ?? "pending-review",
        },
      ],
      nextCursor: after ? null : farmer.id,
    }),
  );
  return client;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  history.replaceState(null, "", "/");
});
it("loads bookmarked filters and resets the page when a filter changes", async () => {
  history.replaceState(
    null,
    "",
    "/?farmerStatus=pending-review&reviewable=true",
  );
  const client = setup();
  render(<FarmerRegistry client={client} />);
  await screen.findByText("Synthetic pending-review");
  expect(client.farmers).toHaveBeenLastCalledWith(
    undefined,
    expect.any(AbortSignal),
    { status: "pending-review", reviewable: "true" },
  );
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Synthetic next page");
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Registration status" }),
    "verified",
  );
  await screen.findByText("Synthetic verified");
  expect(client.farmers).toHaveBeenLastCalledWith(
    undefined,
    expect.any(AbortSignal),
    { status: "verified" },
  );
  expect(
    (screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
    false,
  );
  expect(new URL(location.href).searchParams.get("farmerStatus")).toBe(
    "verified",
  );
  expect(location.href).not.toContain(farmer.fullName);
  expect(localStorage.length).toBe(0);
});
it("adds only a restrictive pending/verify selection and preserves it across pagination", async () => {
  const client = setup();
  render(<FarmerRegistry client={client} />);
  await screen.findByText("Synthetic all");
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Only pending records I may verify" }),
  );
  await screen.findByText("Synthetic pending-review");
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  await screen.findByText("Synthetic next page");
  expect(client.farmers).toHaveBeenLastCalledWith(
    farmer.id,
    expect.any(AbortSignal),
    { status: "pending-review", reviewable: "true" },
  );
  await userEvent.click(screen.getByRole("button", { name: "සිංහල" }));
  expect(screen.getByRole("combobox", { name: "ලියාපදිංචි තත්ත්වය" })).toBeTruthy();
  expect(client.farmers).toHaveBeenCalledTimes(3);
});
it("cancels a pending filter request and ignores its late page", async () => {
  const client = setup();
  render(<FarmerRegistry client={client} />);
  await screen.findByText("Synthetic all");
  let finish!: (page: FarmerPage) => void;
  vi.mocked(client.farmers).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await userEvent.selectOptions(screen.getByRole("combobox"), "draft");
  await waitFor(() => expect(client.farmers).toHaveBeenCalledTimes(2));
  const signal = vi.mocked(client.farmers).mock.calls[1][1]!;
  await userEvent.selectOptions(screen.getByRole("combobox"), "verified");
  await screen.findByText("Synthetic verified");
  expect(signal.aborted).toBe(true);
  finish({
    accountId,
    filters: { status: "draft" },
    items: [{ ...farmer, fullName: "Synthetic late draft", status: "draft" }],
    nextCursor: null,
  });
  await waitFor(() =>
    expect(screen.queryByText("Synthetic late draft")).toBeNull(),
  );
});
it("loads no records for an invalid shared filter until an explicit reset", async () => {
  history.replaceState(null, "", "/?farmerStatus=verified&reviewable=true");
  const client = setup();
  render(<FarmerRegistry client={client} />);
  await screen.findByText(/shared review filters are invalid/);
  expect(client.farmers).not.toHaveBeenCalled();
  expect(client.context).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  await screen.findByText("Synthetic all");
  expect(location.search).toBe("");
});
it("responds to browser history restoration with a fresh filter-bound read", async () => {
  const client = setup();
  render(<FarmerRegistry client={client} />);
  await screen.findByText("Synthetic all");
  history.pushState(null, "", "/?farmerStatus=inactive");
  fireEvent(window, new PopStateEvent("popstate"));
  await screen.findByText("Synthetic inactive");
  expect(client.farmers).toHaveBeenLastCalledWith(
    undefined,
    expect.any(AbortSignal),
    { status: "inactive" },
  );
});
it("does not display a page whose filter identity was omitted", async () => {
  const client = setup();
  render(<FarmerRegistry client={client} />);
  await screen.findByText("Synthetic all");
  vi.mocked(client.farmers).mockResolvedValue({
    accountId,
    items: [{ ...farmer, fullName: "Synthetic wrong unfiltered response" }],
    nextCursor: null,
  });
  await userEvent.selectOptions(screen.getByRole("combobox"), "verified");
  await screen.findByRole("alert");
  expect(screen.queryByText("Synthetic wrong unfiltered response")).toBeNull();
});
