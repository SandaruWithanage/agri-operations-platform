import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { EnrollmentPolicyEditor } from "../apps/admin-web/components/enrollment-policy-edit";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86",
  projectId = "06149451-4004-4a23-a5a2-64a24e485a82";
const created = {
  projectId,
  projectName: "Synthetic policy project",
  version: 0,
  enabled: false,
  eligibleFarmerStatuses: ["verified"] as const,
};
function setup(source = created) {
  const client = new PilotClient(),
    identity = { accountId, deviceId };
  vi.spyOn(client, "sessionIdentity").mockResolvedValue(identity);
  vi.spyOn(client, "enrollmentPolicy").mockResolvedValue({
    accountId,
    projectId,
    policy: null,
  });
  vi.spyOn(client, "setEnrollmentPolicy").mockResolvedValue({
    projectId,
    version: source.version + 1,
    replayed: false,
  });
  const props = {
    draft: { ...identity, id: 1, client, source, boundaryEpoch: 0 },
    activeClient: client,
    boundaryEpoch: 0,
    language: "en" as "en" | "si",
    registerLock: () => () => undefined,
    onSaved: vi.fn(),
    onDiscard: vi.fn(),
    onFailure: vi.fn(),
    onIdle: vi.fn(),
  };
  return { client, props };
}
const review = () =>
  screen.getByLabelText(
    "I reviewed the enabled setting and the selected statuses.",
  );
const save = () =>
  screen.getByRole("button", { name: "Save enrollment policy" });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  localStorage.clear();
});
it("creates a first policy at version 0 only after explicit review and never persists it", async () => {
  const f = setup(),
    storage = vi.spyOn(Storage.prototype, "setItem"),
    db = vi.spyOn(indexedDB, "open");
  render(<EnrollmentPolicyEditor {...f.props} />);
  expect(
    await screen.findByText(
      "No policy exists yet, so enrollment is denied for this project.",
    ),
  ).toBeTruthy();
  expect((save() as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(
    screen.getByLabelText("Allow enrollment in this project"),
  );
  await userEvent.click(screen.getByLabelText("Pending review"));
  await userEvent.click(review());
  await userEvent.click(save());
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledWith(projectId));
  expect(f.client.setEnrollmentPolicy).toHaveBeenCalledWith(
    accountId,
    {
      mutationId: expect.any(String),
      projectId,
      expectedVersion: 0,
      enabled: true,
      eligibleFarmerStatuses: ["pending-review", "verified"],
    },
    deviceId,
  );
  expect(storage).not.toHaveBeenCalled();
  expect(db).not.toHaveBeenCalled();
});
it("clears the review when a value changes again and rejects an empty status list", async () => {
  const f = setup({
    ...created,
    version: 3,
    enabled: true,
    eligibleFarmerStatuses: ["verified"] as const,
  });
  render(<EnrollmentPolicyEditor {...f.props} />);
  await screen.findByLabelText("Allow enrollment in this project");
  await userEvent.click(
    screen.getByLabelText("Allow enrollment in this project"),
  );
  await userEvent.click(review());
  expect((save() as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(screen.getByLabelText("Draft"));
  expect((save() as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByLabelText("Draft"));
  await userEvent.click(screen.getByLabelText("Verified"));
  await userEvent.click(review());
  await userEvent.click(save());
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(f.client.setEnrollmentPolicy).not.toHaveBeenCalled();
});
it("sends the reviewed version and keeps one fixed request after an uncertain failure", async () => {
  const f = setup({
    ...created,
    version: 4,
    enabled: true,
    eligibleFarmerStatuses: ["verified"] as const,
  });
  vi.mocked(f.client.setEnrollmentPolicy).mockRejectedValueOnce(
    new PilotRequestError(503),
  );
  render(<EnrollmentPolicyEditor {...f.props} />);
  await userEvent.click(
    await screen.findByLabelText("Allow enrollment in this project"),
  );
  await userEvent.click(review());
  await userEvent.click(save());
  await waitFor(() =>
    expect(f.client.setEnrollmentPolicy).toHaveBeenCalledTimes(1),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Save enrollment policy" }),
  );
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledWith(projectId));
  const [, first] = vi.mocked(f.client.setEnrollmentPolicy).mock.calls[0];
  const [, second] = vi.mocked(f.client.setEnrollmentPolicy).mock.calls[1];
  expect(second).toEqual(first);
  expect(first.expectedVersion).toBe(4);
});
it("renders Sinhala labels and fails closed when the account changes", async () => {
  const f = setup();
  render(<EnrollmentPolicyEditor {...f.props} language="si" />);
  expect(
    await screen.findByLabelText("මෙම ව්‍යාපෘතියේ ඇතුළත් කිරීමට ඉඩ දෙන්න"),
  ).toBeTruthy();
  cleanup();
  const g = setup();
  vi.mocked(g.client.sessionIdentity).mockResolvedValue({
    accountId: projectId,
    deviceId,
  });
  render(<EnrollmentPolicyEditor {...g.props} />);
  await waitFor(() => expect(g.props.onFailure).toHaveBeenCalled());
  expect(
    screen.queryByLabelText("Allow enrollment in this project"),
  ).toBeNull();
});
it("saves a first policy without touching any field once reviewed", async () => {
  const f = setup();
  render(<EnrollmentPolicyEditor {...f.props} />);
  await screen.findByLabelText("Allow enrollment in this project");
  await userEvent.click(review());
  await userEvent.click(save());
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledWith(projectId));
});
