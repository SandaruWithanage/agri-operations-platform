import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import { EnrollmentCreateEditor } from "../apps/admin-web/components/enrollment-create";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86",
  farmerId = "06149451-4004-4a23-a5a2-64a24e485a82",
  projectId = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  organizationId = "c8a85c92-740b-48d5-99d0-1cda6c4cd31c";
const farmer = {
  id: farmerId,
  fullName: "Synthetic enrolling farmer",
  geographyId: organizationId,
  geographyName: "Synthetic village",
  version: 1,
  createdAt: "2026-11-16T00:00:00Z",
  status: "verified" as const,
  duplicateRisk: false,
};
const project = {
  id: projectId,
  organizationId,
  organizationName: "Synthetic organization",
  name: "Synthetic project",
  active: true,
  version: 1,
  createdAt: "2026-11-16T00:00:00Z",
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
    items: [farmer],
    nextCursor: null,
    filters: {},
  } as never);
  vi.spyOn(client, "farmer").mockResolvedValue({
    accountId,
    farmer,
    access: { correct: false, viewAudit: false },
  } as never);
  vi.spyOn(client, "projects").mockResolvedValue({
    accountId,
    items: [project],
    nextCursor: null,
  });
  vi.spyOn(client, "enrollFarmer").mockImplementation(
    async (_owner, input) => ({
      enrollmentId: input.enrollmentId,
      version: 1,
      replayed: false,
    }),
  );
  const props = {
    draft: {
      ...identity,
      id: 1,
      client,
      boundaryEpoch: 0,
      source: { farmerId, farmerName: farmer.fullName },
    },
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
  screen.getByLabelText("I reviewed the farmer and the project.");
const submit = () => screen.getByRole("button", { name: "Enroll farmer" });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("requires a chosen project and review, then sends a fixed explicit request without persistence", async () => {
  const f = setup(),
    store = vi.spyOn(Storage.prototype, "setItem"),
    db = vi.spyOn(indexedDB, "open");
  render(<EnrollmentCreateEditor {...f.props} />);
  await screen.findByText("Farmer: Synthetic enrolling farmer");
  expect((submit() as HTMLButtonElement).disabled).toBe(true);
  expect((review() as HTMLInputElement).disabled).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("Project"), projectId);
  await userEvent.click(review());
  await userEvent.click(submit());
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalled());
  expect(f.client.enrollFarmer).toHaveBeenCalledWith(
    accountId,
    {
      mutationId: expect.any(String),
      enrollmentId: expect.any(String),
      projectId,
      farmerId,
    },
    deviceId,
  );
  expect(store).not.toHaveBeenCalled();
  expect(db).not.toHaveBeenCalled();
});
it("clears the review when the project changes and keeps one fixed retry after an uncertain failure", async () => {
  const f = setup();
  vi.mocked(f.client.projects).mockResolvedValue({
    accountId,
    items: [project, { ...project, id: farmerId, name: "Second project" }],
    nextCursor: null,
  });
  vi.mocked(f.client.enrollFarmer).mockRejectedValueOnce(
    new PilotRequestError(503),
  );
  render(<EnrollmentCreateEditor {...f.props} />);
  await screen.findByLabelText("Project");
  await userEvent.selectOptions(screen.getByLabelText("Project"), projectId);
  await userEvent.click(review());
  await userEvent.selectOptions(screen.getByLabelText("Project"), farmerId);
  expect((submit() as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(review());
  await userEvent.click(submit());
  await waitFor(() => expect(f.client.enrollFarmer).toHaveBeenCalledTimes(1));
  await userEvent.click(
    await screen.findByRole("button", { name: "Enroll farmer" }),
  );
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalled());
  const [, first] = vi.mocked(f.client.enrollFarmer).mock.calls[0];
  const [, second] = vi.mocked(f.client.enrollFarmer).mock.calls[1];
  expect(second).toEqual(first);
  expect(first.projectId).toBe(farmerId);
});
it("fails closed for a changed account, an unreadable farmer or an oversized catalog", async () => {
  const a = setup();
  vi.mocked(a.client.sessionIdentity).mockResolvedValue({
    accountId: projectId,
    deviceId,
  });
  render(<EnrollmentCreateEditor {...a.props} />);
  await waitFor(() => expect(a.props.onFailure).toHaveBeenCalled());
  cleanup();
  const b = setup();
  vi.mocked(b.client.farmer).mockRejectedValue(new PilotRequestError(404));
  render(<EnrollmentCreateEditor {...b.props} />);
  await waitFor(() => expect(b.props.onFailure).toHaveBeenCalled());
  expect(screen.queryByLabelText("Project")).toBeNull();
  cleanup();
  const c = setup();
  vi.mocked(c.client.projects).mockResolvedValue({
    accountId,
    items: [project],
    nextCursor: projectId,
  });
  render(<EnrollmentCreateEditor {...c.props} />);
  await waitFor(() => expect(c.props.onFailure).toHaveBeenCalled());
  expect(c.client.projects).toHaveBeenCalledTimes(4);
  expect(screen.queryByLabelText("Project")).toBeNull();
});
it("offers enrollment from the farmer detail without enrolling automatically, in Sinhala too", async () => {
  const f = setup();
  render(<FarmerRegistry client={f.client} />);
  await userEvent.click(
    await screen.findByRole("button", {
      name: /View|Open|Synthetic enrolling farmer/,
    }),
  );
  const start = await screen.findByRole("button", {
    name: "Enroll in a project",
  });
  expect(f.client.enrollFarmer).not.toHaveBeenCalled();
  await userEvent.click(start);
  expect(await screen.findByLabelText("Project")).toBeTruthy();
  expect(f.client.enrollFarmer).not.toHaveBeenCalled();
  cleanup();
  render(<EnrollmentCreateEditor {...setup().props} language="si" />);
  expect(await screen.findByLabelText("ව්‍යාපෘතිය")).toBeTruthy();
});
