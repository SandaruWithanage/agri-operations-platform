import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import { ProjectRegistrationEditor } from "../apps/admin-web/components/project-registration";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86",
  organizationId = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  id = "06149451-4004-4a23-a5a2-64a24e485a82";
const project = {
  id,
  organizationId,
  organizationName: "Synthetic catalog organization",
  name: "Synthetic project",
  active: false,
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
    items: [],
    nextCursor: null,
  });
  vi.spyOn(client, "projects").mockResolvedValue({
    accountId,
    items: [project],
    nextCursor: null,
  });
  vi.spyOn(client, "project").mockResolvedValue({ accountId, project });
  vi.spyOn(client, "projectOrganizations").mockResolvedValue({
    accountId,
    organizations: [{ id: organizationId, name: project.organizationName }],
  });
  vi.spyOn(client, "registerProject").mockImplementation(
    async (_owner, input) => ({
      status: "synced",
      projectId: input.projectId,
      replayed: false,
    }),
  );
  let lock: (() => void) | undefined;
  const props = {
    draft: { id: 1, client, ...identity, boundaryEpoch: 0 },
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
  return { client, identity, props, lock: () => lock?.() };
}
async function openProjects() {
  await screen.findByText(
    "No farmer records are available within your current read permissions.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Projects", exact: true }),
  );
}
async function fill() {
  await userEvent.type(
    await screen.findByLabelText("Project name"),
    "Synthetic configured project",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Organization"),
    organizationId,
  );
}
async function save() {
  await userEvent.click(
    screen.getByRole("button", { name: "Save catalog project", exact: true }),
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
it("displays the authorized catalog/detail and switches Sinhala without persisting records", async () => {
  const f = setup(),
    store = vi.spyOn(Storage.prototype, "setItem"),
    db = vi.spyOn(indexedDB, "open");
  render(<FarmerRegistry client={f.client} />);
  await openProjects();
  await screen.findByText(project.name);
  await userEvent.click(
    screen.getByRole("button", { name: `View project: ${project.name}` }),
  );
  await screen.findByRole("heading", { name: project.name });
  await userEvent.click(
    screen.getByRole("button", { name: "සිංහල", exact: true }),
  );
  await screen.findByRole("button", { name: "ව්‍යාපෘතිය වසන්න" });
  expect(screen.getByRole("heading", { name: project.name })).toBeTruthy();
  expect(store.mock.calls.every((call) => call[0] === "agri-language")).toBe(
    true,
  );
  expect(db).not.toHaveBeenCalled();
});
it("creates only a configured project and defaults to disabled without implying enrollment or read access", async () => {
  const f = setup();
  vi.mocked(f.client.projects).mockResolvedValue({
    accountId,
    items: [],
    nextCursor: null,
  });
  render(<FarmerRegistry client={f.client} />);
  await openProjects();
  await screen.findByText(
    "No projects are available within your current catalog read permissions.",
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Create catalog project" }),
  );
  await fill();
  await save();
  await screen.findByText(/Project catalog entry accepted/);
  await screen.findByText(
    "No projects are available within your current catalog read permissions.",
  );
  expect(f.client.registerProject).toHaveBeenCalledWith(
    accountId,
    {
      mutationId: expect.any(String),
      projectId: expect.any(String),
      organizationId,
      name: "Synthetic configured project",
      active: false,
    },
    deviceId,
  );
  expect(f.client.project).not.toHaveBeenCalled();
});
it("retains an identical submission after an uncertain result, lock and language switch", async () => {
  const f = setup();
  vi.mocked(f.client.registerProject).mockRejectedValueOnce(
    new PilotRequestError(503),
  );
  const view = render(<ProjectRegistrationEditor {...f.props} />);
  await fill();
  await save();
  await screen.findByRole("alert");
  const sent = vi.mocked(f.client.registerProject).mock.calls[0][1];
  act(() => f.lock());
  expect(screen.queryByLabelText("Project name")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen project" }),
  );
  await screen.findByLabelText("Project name");
  view.rerender(<ProjectRegistrationEditor {...f.props} language="si" />);
  expect((screen.getByLabelText("ව්‍යාපෘති නම") as HTMLInputElement).value).toBe(
    sent.name,
  );
  expect(
    (screen.getByLabelText("ව්‍යාපෘති නම") as HTMLInputElement).disabled,
  ).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: "නාමාවලි ව්‍යාපෘතිය සුරකින්න" }),
  );
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(vi.mocked(f.client.registerProject).mock.calls[1][1]).toEqual(sent);
});
it("hides the retained project if organization-create coverage is revoked", async () => {
  const f = setup();
  render(<ProjectRegistrationEditor {...f.props} />);
  await fill();
  act(() => f.lock());
  vi.mocked(f.client.projectOrganizations).mockResolvedValue({
    accountId,
    organizations: [],
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Check access and reopen project" }),
  );
  await waitFor(() =>
    expect(f.props.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403 }),
    ),
  );
  expect(screen.queryByLabelText("Project name")).toBeNull();
  expect(f.client.registerProject).not.toHaveBeenCalled();
});
it.each(["accountId", "deviceId"] as const)(
  "refuses changed %s before restoring project fields",
  async (key) => {
    const f = setup();
    render(<ProjectRegistrationEditor {...f.props} />);
    await fill();
    act(() => f.lock());
    vi.mocked(f.client.sessionIdentity).mockResolvedValue({
      ...f.identity,
      [key]: organizationId,
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Check access and reopen project" }),
    );
    await waitFor(() => expect(f.props.onFailure).toHaveBeenCalled());
    expect(screen.queryByLabelText("Project name")).toBeNull();
  },
);
it("rejects catalog responses for another account without displaying their rows", async () => {
  const f = setup();
  vi.mocked(f.client.projects).mockResolvedValue({
    accountId: organizationId,
    items: [project],
    nextCursor: null,
  });
  render(<FarmerRegistry client={f.client} />);
  await openProjects();
  await screen.findByLabelText("Password");
  expect(screen.queryByText(project.name)).toBeNull();
});
it("does not let a late read repopulate the catalog after changing domains", async () => {
  const f = setup();
  let finish!: (value: Awaited<ReturnType<PilotClient["projects"]>>) => void;
  vi.mocked(f.client.projects).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<FarmerRegistry client={f.client} />);
  await openProjects();
  await waitFor(() => expect(f.client.projects).toHaveBeenCalledOnce());
  await userEvent.click(
    screen.getByRole("button", { name: "Farmers", exact: true }),
  );
  await act(async () =>
    finish({ accountId, items: [project], nextCursor: null }),
  );
  expect(screen.queryByText(project.name)).toBeNull();
});
