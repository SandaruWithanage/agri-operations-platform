import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import { EnrollmentWithdrawEditor } from "../apps/admin-web/components/enrollment-withdraw";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86",
  id = "06149451-4004-4a23-a5a2-64a24e485a82",
  projectId = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  farmerId = "f7e0c8bc-3dcb-4be7-ab63-d80f4099220a",
  organizationId = "c8a85c92-740b-48d5-99d0-1cda6c4cd31c";
const enrollment = {
  id,
  organizationId,
  projectId,
  farmerId,
  status: "enrolled" as const,
  version: 1,
  enrolledAt: "2026-11-16T00:00:00.000Z",
  withdrawnAt: null,
};
function setup() {
  const client = new PilotClient(),
    identity = { accountId, deviceId };
  vi.spyOn(client, "context").mockResolvedValue({
    ...identity,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: 1,
    offlineUntil: 60001,
    geographies: [],
  });
  vi.spyOn(client, "sessionIdentity").mockResolvedValue(identity);
  vi.spyOn(client, "farmers").mockResolvedValue({
    accountId,
    items: [],
    nextCursor: null,
  });
  vi.spyOn(client, "enrollments").mockResolvedValue({
    accountId,
    items: [enrollment],
    nextCursor: null,
  });
  vi.spyOn(client, "enrollment").mockResolvedValue({ accountId, enrollment });
  vi.spyOn(client, "withdrawEnrollment").mockResolvedValue({
    enrollmentId: id,
    version: 2,
    replayed: false,
  });
  let lock: (() => void) | undefined;
  const props = {
    draft: {
      ...identity,
      id: 1,
      client,
      boundaryEpoch: 0,
      source: { id, projectId, farmerId, version: 1 },
    },
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
  return { client, props };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("lists and opens authorized enrollments without persisting them, then switches to Sinhala", async () => {
  const f = setup(),
    store = vi.spyOn(Storage.prototype, "setItem"),
    db = vi.spyOn(indexedDB, "open");
  render(<FarmerRegistry client={f.client} />);
  await screen.findByText(
    "No farmer records are available within your current read permissions.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Enrollments", exact: true }),
  );
  await screen.findByText(projectId);
  expect(screen.getByText(farmerId)).toBeTruthy();
  expect(screen.getByText("Enrolled")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: `View enrollment: ${id}` }),
  );
  expect(
    await screen.findByRole("button", { name: "Withdraw enrollment" }),
  ).toBeTruthy();
  expect(f.client.enrollment).toHaveBeenCalledWith(id, expect.anything());
  // Records are never persisted; only the optional language preference may be stored.
  expect(store).not.toHaveBeenCalled();
  expect(db).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "සිංහල" }));
  expect(await screen.findByText("ඇතුළත් කර ඇත")).toBeTruthy();
});
it("shows no withdraw action for a withdrawn enrollment and an empty state for no rows", async () => {
  const f = setup();
  vi.mocked(f.client.enrollment).mockResolvedValue({
    accountId,
    enrollment: {
      ...enrollment,
      status: "withdrawn",
      version: 2,
      withdrawnAt: "2026-11-16T01:00:00.000Z",
    },
  });
  render(<FarmerRegistry client={f.client} />);
  await screen.findByText(
    "No farmer records are available within your current read permissions.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Enrollments", exact: true }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: `View enrollment: ${id}` }),
  );
  await screen.findByText("Withdrawn on");
  expect(
    screen.queryByRole("button", { name: "Withdraw enrollment" }),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Close enrollment" }),
  );
  vi.mocked(f.client.enrollments).mockResolvedValue({
    accountId,
    items: [],
    nextCursor: null,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Check session and refresh" }),
  );
  expect(
    await screen.findByText(
      "No enrollments are available within your current permissions.",
    ),
  ).toBeTruthy();
});
it("withdraws only after review, sending the reviewed version with a fixed retry", async () => {
  const f = setup();
  vi.mocked(f.client.withdrawEnrollment).mockRejectedValueOnce(
    new PilotRequestError(503),
  );
  render(<EnrollmentWithdrawEditor {...f.props} />);
  const submit = await screen.findByRole("button", {
    name: "Withdraw enrollment",
  });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(
    screen.getByLabelText(
      "I reviewed this enrollment and want to withdraw it.",
    ),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Withdraw enrollment" }),
  );
  await waitFor(() =>
    expect(f.client.withdrawEnrollment).toHaveBeenCalledTimes(1),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Withdraw enrollment" }),
  );
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledWith(id));
  const [owner, first, device] = vi.mocked(f.client.withdrawEnrollment).mock
    .calls[0];
  const second = vi.mocked(f.client.withdrawEnrollment).mock.calls[1][1];
  expect(owner).toBe(accountId);
  expect(device).toBe(deviceId);
  expect(first).toEqual({
    mutationId: expect.any(String),
    enrollmentId: id,
    expectedVersion: 1,
  });
  expect(second).toEqual(first);
});
it("fails closed when the enrollment is already withdrawn or the account changed", async () => {
  const f = setup();
  vi.mocked(f.client.enrollment).mockResolvedValue({
    accountId,
    enrollment: {
      ...enrollment,
      status: "withdrawn",
      version: 2,
      withdrawnAt: "2026-11-16T01:00:00.000Z",
    },
  });
  render(<EnrollmentWithdrawEditor {...f.props} />);
  await waitFor(() => expect(f.props.onFailure).toHaveBeenCalled());
  expect(screen.queryByLabelText(/I reviewed this enrollment/)).toBeNull();
  cleanup();
  const g = setup();
  vi.mocked(g.client.sessionIdentity).mockResolvedValue({
    accountId: id,
    deviceId,
  });
  render(<EnrollmentWithdrawEditor {...g.props} />);
  await waitFor(() => expect(g.props.onFailure).toHaveBeenCalled());
  expect(g.client.withdrawEnrollment).not.toHaveBeenCalled();
});
