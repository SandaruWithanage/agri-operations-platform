import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { ProjectEditor } from "../apps/admin-web/components/project-edit";
import { FarmerRegistry } from "../apps/admin-web/components/farmer-registry";
import { PilotClient, PilotRequestError } from "../packages/sync-client/src";
const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2",
  deviceId = "38f0dbdd-85db-4c75-bced-066e8ea54b86";
const source = {
  id: "06149451-4004-4a23-a5a2-64a24e485a82",
  organizationId: "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9",
  name: "Synthetic original project",
  active: false,
  version: 1,
};
const edited = "Synthetic reviewed project";
function setup() {
  const client = new PilotClient(),
    identity = { accountId, deviceId },
    project = {
      ...source,
      organizationName: "Synthetic configured organization",
      createdAt: "2026-11-16T00:00:00Z",
    };
  vi.spyOn(client, "sessionIdentity").mockResolvedValue(identity);
  vi.spyOn(client, "project").mockResolvedValue({
    accountId,
    project,
    access: { edit: true },
  });
  vi.spyOn(client, "changeProject").mockResolvedValue({
    projectId: source.id,
    version: 2,
    replayed: false,
  });
  let lock: (() => void) | undefined;
  const props = {
    draft: { ...identity, id: 1, client, source, boundaryEpoch: 0 },
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
  return { client, identity, project, props, lock: () => lock?.() };
}
async function change() {
  const input = await screen.findByLabelText("Edited project name");
  await userEvent.clear(input);
  await userEvent.type(input, edited);
}
async function submit() {
  await userEvent.click(
    screen.getByLabelText("I reviewed the project name and catalog flag."),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save project edit", exact: true }),
  );
}
async function reopen() {
  await userEvent.click(
    screen.getByRole("button", {
      name: "Check access and reopen project edit",
    }),
  );
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  localStorage.clear();
});
it("requires a changed value and explicit review, preserving the original version without persistence", async () => {
  const f = setup(),
    storage = vi.spyOn(Storage.prototype, "setItem"),
    db = vi.spyOn(indexedDB, "open");
  render(<ProjectEditor {...f.props} />);
  await screen.findByLabelText("Edited project name");
  expect(
    (
      screen.getByRole("button", {
        name: "Save project edit",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await change();
  expect(unload()).toBe(true);
  await submit();
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledWith(source.id));
  expect(f.client.changeProject).toHaveBeenCalledWith(
    accountId,
    {
      mutationId: expect.any(String),
      projectId: source.id,
      expectedVersion: 1,
      name: edited,
      active: false,
    },
    deviceId,
  );
  expect(storage).not.toHaveBeenCalled();
  expect(db).not.toHaveBeenCalled();
});
it("clears confirmation when values change again", async () => {
  const f = setup();
  render(<ProjectEditor {...f.props} />);
  await change();
  await userEvent.click(
    screen.getByLabelText("I reviewed the project name and catalog flag."),
  );
  await userEvent.click(screen.getByLabelText("Enabled in catalog"));
  expect(
    (
      screen.getByRole("button", {
        name: "Save project edit",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(f.client.changeProject).not.toHaveBeenCalled();
});
it("retains exact retry after an uncertain commit, lock, newer record and Sinhala switch", async () => {
  const f = setup();
  vi.mocked(f.client.changeProject).mockRejectedValueOnce(
    new PilotRequestError(503),
  );
  const view = render(<ProjectEditor {...f.props} />);
  await change();
  await submit();
  await screen.findByRole("alert");
  const sent = vi.mocked(f.client.changeProject).mock.calls[0][1];
  act(() => f.lock());
  expect(screen.queryByDisplayValue(edited)).toBeNull();
  expect(unload()).toBe(true);
  vi.mocked(f.client.project).mockResolvedValue({
    accountId,
    project: { ...f.project, name: edited, version: 2 },
    access: { edit: true },
  });
  await reopen();
  await screen.findByLabelText("Edited project name");
  view.rerender(<ProjectEditor {...f.props} language="si" />);
  expect(
    (screen.getByLabelText("සංස්කරණය කළ ව්‍යාපෘති නම") as HTMLInputElement).value,
  ).toBe(edited);
  expect(
    (screen.getByLabelText("සංස්කරණය කළ ව්‍යාපෘති නම") as HTMLInputElement)
      .disabled,
  ).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: "ව්‍යාපෘති සංස්කරණය සුරකින්න" }),
  );
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(vi.mocked(f.client.changeProject).mock.calls[1][1]).toEqual(sent);
});
it("locks rather than exposing old fields if the project moves to another organization", async () => {
  const f = setup();
  render(<ProjectEditor {...f.props} />);
  await change();
  act(() => f.lock());
  vi.mocked(f.client.project).mockResolvedValue({
    accountId,
    project: { ...f.project, organizationId: deviceId },
    access: { edit: true },
  });
  await reopen();
  await waitFor(() =>
    expect(f.props.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403 }),
    ),
  );
  expect(screen.queryByLabelText("Edited project name")).toBeNull();
  expect(unload()).toBe(true);
});
it.each(["accountId", "deviceId"] as const)(
  "keeps values locked under a changed %s",
  async (key) => {
    const f = setup();
    render(<ProjectEditor {...f.props} />);
    await change();
    act(() => f.lock());
    vi.mocked(f.client.sessionIdentity).mockResolvedValue({
      ...f.identity,
      [key]: source.id,
    });
    await reopen();
    await waitFor(() => expect(f.props.onFailure).toHaveBeenCalled());
    expect(screen.queryByLabelText("Edited project name")).toBeNull();
  },
);
it("does not infer editing permission from read or create permission", async () => {
  const f = setup();
  vi.mocked(f.client.project).mockResolvedValue({
    accountId,
    project: f.project,
    access: { edit: false },
  });
  render(<ProjectEditor {...f.props} />);
  await waitFor(() => expect(f.props.onFailure).toHaveBeenCalled());
  expect(screen.queryByLabelText("Edited project name")).toBeNull();
  expect(f.client.changeProject).not.toHaveBeenCalled();
});
it("retains the original intent after a conflict without rebasing", async () => {
  const f = setup();
  vi.mocked(f.client.changeProject).mockRejectedValue(
    new PilotRequestError(409),
  );
  render(<ProjectEditor {...f.props} />);
  await change();
  await submit();
  await screen.findByText(/project changed or the request conflicts/);
  expect(
    (
      screen.getByRole("button", {
        name: "Save project edit",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Edited project name") as HTMLInputElement).value,
  ).toBe(edited);
  expect(unload()).toBe(true);
});
it("ignores an acknowledgement arriving after a lock and retains the same request", async () => {
  const f = setup();
  let finish!: (value: {
    projectId: string;
    version: number;
    replayed: boolean;
  }) => void;
  vi.mocked(f.client.changeProject).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<ProjectEditor {...f.props} />);
  await change();
  await submit();
  act(() => f.lock());
  await act(async () =>
    finish({ projectId: source.id, version: 2, replayed: false }),
  );
  expect(f.props.onSaved).not.toHaveBeenCalled();
  expect(unload()).toBe(true);
  await reopen();
  await screen.findByLabelText("Edited project name");
  await userEvent.click(
    screen.getByRole("button", { name: "Save project edit" }),
  );
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalledOnce());
  expect(vi.mocked(f.client.changeProject).mock.calls[1][1]).toEqual(
    vi.mocked(f.client.changeProject).mock.calls[0][1],
  );
});
it("does not queue a paused edit for automatic reconnect submission", async () => {
  const f = setup();
  vi.mocked(f.client.changeProject).mockRejectedValue(
    new PilotRequestError(503),
  );
  render(<ProjectEditor {...f.props} />);
  await change();
  act(() => onlineManager.setOnline(false));
  await submit();
  await screen.findByRole("alert");
  expect(f.client.changeProject).toHaveBeenCalledOnce();
  await act(async () => onlineManager.setOnline(true));
  expect(f.client.changeProject).toHaveBeenCalledOnce();
});
it("keeps its mounted target and reviewed version fixed if parent source props refresh", async () => {
  const f = setup(),
    view = render(<ProjectEditor {...f.props} />);
  await change();
  view.rerender(
    <ProjectEditor
      {...f.props}
      draft={{
        ...f.props.draft,
        source: { ...source, id: deviceId, version: 9 },
      }}
    />,
  );
  await submit();
  await waitFor(() => expect(f.props.onSaved).toHaveBeenCalled());
  expect(vi.mocked(f.client.changeProject).mock.calls[0][1]).toMatchObject({
    projectId: source.id,
    expectedVersion: 1,
  });
});
it("refreshes the authoritative project detail after success rather than the farmer domain", async () => {
  const f = setup();
  vi.spyOn(f.client, "context").mockResolvedValue({
    ...f.identity,
    deviceKeyFingerprint: "a".repeat(64),
    verifiedAt: 1,
    offlineUntil: 60001,
    geographies: [],
  });
  vi.spyOn(f.client, "farmers").mockResolvedValue({
    accountId,
    items: [],
    nextCursor: null,
  });
  vi.spyOn(f.client, "projects").mockResolvedValue({
    accountId,
    items: [f.project],
    nextCursor: null,
  });
  const farmer = vi.spyOn(f.client, "farmer");
  vi.mocked(f.client.changeProject).mockImplementation(async () => {
    vi.mocked(f.client.project).mockResolvedValue({
      accountId,
      project: { ...f.project, name: edited, version: 2 },
      access: { edit: true },
    });
    return { projectId: source.id, version: 2, replayed: false };
  });
  render(<FarmerRegistry client={f.client} />);
  await screen.findByText(
    "No farmer records are available within your current read permissions.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Projects", exact: true }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: `View project: ${source.name}` }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit catalog project" }),
  );
  await change();
  await submit();
  await screen.findByRole("heading", { name: edited });
  expect(screen.queryByLabelText("Edited project name")).toBeNull();
  expect(farmer).not.toHaveBeenCalled();
});
