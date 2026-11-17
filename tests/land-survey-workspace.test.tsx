import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LandSurveyWorkspace } from "../apps/field-pwa/components/land-survey-workspace";
import { PilotRequestError } from "../apps/field-pwa/lib/pilot-client";

vi.mock("../apps/field-pwa/components/walk-survey-screen", () => ({
  WalkSurveyScreen: (props: Record<string, unknown>) => (
    <div
      data-testid="walk"
      data-land={String(props.landId)}
      data-version={String(props.expectedVersion)}
      data-account={String(props.accountId)}
    />
  ),
}));

const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const a = "06149451-4004-4a23-a5a2-64a24e485a82";
const b = "808b5df8-5c7b-4f51-9b9f-dc0424ed60c9";
const page = (items: string[], nextCursor: string | null = null) => ({
  accountId,
  items: items.map((id, i) => ({
    id,
    label: i === 0 && id === a ? "Plot A" : null,
    geographyName: "Synthetic village",
  })),
  nextCursor,
});
function client(over: Record<string, unknown> = {}) {
  return {
    sessionIdentity: vi.fn().mockResolvedValue({ accountId, deviceId: "d" }),
    land: vi.fn().mockResolvedValue(page([a, b])),
    landGeometry: vi
      .fn()
      .mockResolvedValue({ current: { version: 3, calculatedAreaM2: 12000 } }),
    recordLandGeometry: vi.fn(),
    ...over,
  };
}
function mount(c: ReturnType<typeof client>, language: "en" | "si" = "en") {
  render(<LandSurveyWorkspace language={language} client={c as never} />);
  return userEvent.setup();
}
afterEach(() => cleanup());

describe("land survey workspace", () => {
  it("lists assigned lands, loads the current version and mounts the survey for the chosen land only", async () => {
    const c = client();
    const user = mount(c);
    await screen.findByLabelText("Land");
    expect(screen.queryByTestId("walk")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Land"), a);
    const walk = await screen.findByTestId("walk");
    expect(walk.dataset).toMatchObject({
      land: a,
      version: "3",
      account: accountId,
    });
    expect(c.landGeometry).toHaveBeenCalledWith(a);
    expect(
      screen.getByText(/Existing provisional polygon version 3/),
    ).toBeTruthy();
    expect(screen.getByText(/kept as history, not overwritten/)).toBeTruthy();
  });

  it("starts at version 0 when a land has no polygon yet", async () => {
    const c = client({
      landGeometry: vi.fn().mockRejectedValue(new PilotRequestError(404)),
    });
    const user = mount(c);
    await user.selectOptions(await screen.findByLabelText("Land"), b);
    expect((await screen.findByTestId("walk")).dataset.version).toBe("0");
    expect(screen.getByText("This land has no polygon yet.")).toBeTruthy();
  });

  it("discards a slow response for a land the officer already moved away from", async () => {
    let releaseFirst: (value: unknown) => void = () => undefined;
    const landGeometry = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (releaseFirst = resolve)),
      )
      .mockResolvedValueOnce({ current: { version: 7, calculatedAreaM2: 1 } });
    const user = mount(client({ landGeometry }));
    const select = await screen.findByLabelText("Land");
    await user.selectOptions(select, a);
    await user.selectOptions(select, b);
    expect((await screen.findByTestId("walk")).dataset).toMatchObject({
      land: b,
      version: "7",
    });
    await act(async () =>
      releaseFirst({ current: { version: 1, calculatedAreaM2: 1 } }),
    );
    expect(screen.getByTestId("walk").dataset).toMatchObject({
      land: b,
      version: "7",
    });
  });

  it("returns to the picker and clears the survey", async () => {
    const user = mount(client());
    await user.selectOptions(await screen.findByLabelText("Land"), a);
    await screen.findByTestId("walk");
    await user.click(
      screen.getByRole("button", { name: "Choose another land" }),
    );
    expect(screen.queryByTestId("walk")).toBeNull();
  });

  it("loads more lands with the cursor and shows an empty state", async () => {
    const land = vi
      .fn()
      .mockResolvedValueOnce(page([a], "cursor-1"))
      .mockResolvedValueOnce(page([b]));
    const user = mount(client({ land }));
    await screen.findByLabelText("Land");
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    expect(land).toHaveBeenLastCalledWith("cursor-1");
    cleanup();
    mount(client({ land: vi.fn().mockResolvedValue(page([])) }));
    expect(
      await screen.findByText("No land is available to you."),
    ).toBeTruthy();
  });

  it("reports signed-out, denied and failed loads without showing lands, and can retry", async () => {
    mount(
      client({
        sessionIdentity: vi.fn().mockRejectedValue(new PilotRequestError(401)),
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Sign in on the home page",
    );
    cleanup();
    mount(
      client({ land: vi.fn().mockRejectedValue(new PilotRequestError(403)) }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "do not have permission",
    );
    cleanup();
    const land = vi
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce(page([a]));
    const user = mount(client({ land }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Land")).toBeTruthy();
  });

  it("does not mount the survey when geometry loading fails or is denied", async () => {
    const user = mount(
      client({
        landGeometry: vi.fn().mockRejectedValue(new PilotRequestError(503)),
      }),
    );
    await user.selectOptions(await screen.findByLabelText("Land"), a);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load",
    );
    expect(screen.queryByTestId("walk")).toBeNull();
    cleanup();
    const denied = mount(
      client({
        landGeometry: vi.fn().mockRejectedValue(new PilotRequestError(403)),
      }),
    );
    await denied.selectOptions(await screen.findByLabelText("Land"), a);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "do not have permission",
    );
    expect(screen.queryByTestId("walk")).toBeNull();
  });

  it("renders in Sinhala", async () => {
    mount(client(), "si");
    expect(await screen.findByText("ඉඩම් මායිම මැනීම")).toBeTruthy();
  });
});
