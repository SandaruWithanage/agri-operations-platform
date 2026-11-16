import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import { PilotClient } from "../packages/sync-client/src";
// Keep this first workspace in its own isolated file: both counters begin at one.
// The registry provider and draft must have different sibling keys on a fresh page.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("isolates the first registry and first correction across a shared locale transition", async () => {
  const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
    deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
  const farmer = {
    id: "06149451-4004-4a23-a5a2-64a24e485a82",
    fullName: "Synthetic first workspace",
    geographyId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
    geographyName: "Synthetic configured village",
    status: "pending-review" as const,
    version: 1,
    createdAt: "2026-11-16T00:00:00Z",
    duplicateRisk: false,
  };
  const client = new PilotClient();
  vi.spyOn(client, "context").mockResolvedValue({
    accountId,
    deviceId,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: 1,
    offlineUntil: 60001,
    geographies: [],
  });
  vi.spyOn(client, "sessionIdentity").mockResolvedValue({
    accountId,
    deviceId,
  });
  vi.spyOn(client, "farmers").mockResolvedValue({
    accountId,
    items: [farmer],
    nextCursor: null,
  });
  vi.spyOn(client, "farmer").mockResolvedValue({
    accountId,
    farmer,
    access: { correct: true, viewAudit: false },
  });
  vi.spyOn(client, "farmerCorrectionGeographies").mockResolvedValue({
    accountId,
    farmerId: farmer.id,
    farmerVersion: 1,
    sourceGeographyId: farmer.geographyId,
    geographies: [{ id: farmer.geographyId, name: farmer.geographyName }],
    nextCursor: null,
  });
  render(<FarmerRegistry client={client} />);
  await screen.findByText(farmer.fullName);
  await userEvent.click(
    screen.getByRole("button", { name: `View record: ${farmer.fullName}` }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Correct record", exact: true }),
  );
  const input = await screen.findByLabelText("Corrected full name");
  await userEvent.clear(input);
  await userEvent.type(input, "Synthetic retained locale edit");
  await userEvent.click(
    screen.getByRole("button", { name: "සිංහල", exact: true }),
  );
  expect(
    ((await screen.findByLabelText("නිවැරදි කළ සම්පූර්ණ නම")) as HTMLInputElement)
      .value,
  ).toBe("Synthetic retained locale edit");
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(client.sessionIdentity).toHaveBeenCalledOnce();
  await userEvent.click(
    screen.getByRole("button", { name: "English", exact: true }),
  );
  expect(
    (screen.getByLabelText("Corrected full name") as HTMLInputElement).value,
  ).toBe("Synthetic retained locale edit");
  expect(screen.getAllByRole("main")).toHaveLength(1);
});
