import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LandSurveyWorkspace } from "../apps/field-pwa/components/land-survey-workspace";
import { PilotRequestError } from "../apps/field-pwa/lib/pilot-client";

vi.mock("../apps/field-pwa/components/walk-survey-screen", async () => {
  const { useEffect } = await import("react");
  return {
    WalkSurveyScreen: (props: Record<string, unknown>) => {
      useEffect(() => {
        const notify = props.onActivityChange as
          ((active: boolean) => void) | undefined;
        notify?.(true);
        return () => notify?.(false);
      }, []);
      return (
        <div
          data-testid="walk"
          data-land={String(props.landId)}
          data-version={String(props.expectedVersion)}
          data-account={String(props.accountId)}
        >
          <button
            onClick={() =>
              (props.onBusyChange as ((busy: boolean) => void) | undefined)?.(
                true,
              )
            }
          >
            simulate-busy
          </button>
        </div>
      );
    },
  };
});

const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const accountB = "b50456eb-af66-41f0-8c38-0bc827249cd3";
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
    landGeometry: vi.fn().mockResolvedValue({
      accountId,
      current: { version: 3, calculatedAreaM2: 12000 },
    }),
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
    expect(c.landGeometry.mock.calls[0][0]).toBe(a);
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
      .mockResolvedValueOnce({
        accountId,
        current: { version: 7, calculatedAreaM2: 1 },
      });
    const user = mount(client({ landGeometry }));
    const select = await screen.findByLabelText("Land");
    await user.selectOptions(select, a);
    await user.selectOptions(select, b);
    expect((await screen.findByTestId("walk")).dataset).toMatchObject({
      land: b,
      version: "7",
    });
    await act(async () =>
      releaseFirst({ accountId, current: { version: 1, calculatedAreaM2: 1 } }),
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
    expect(land.mock.calls.at(-1)?.[0]).toBe("cursor-1");
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

  it("blocks switching land, loading more or going back while a save is busy", async () => {
    const land = vi.fn().mockResolvedValue(page([a, b], "cursor-1"));
    const user = mount(client({ land }));
    await user.selectOptions(await screen.findByLabelText("Land"), a);
    await screen.findByTestId("walk");
    await user.click(screen.getByRole("button", { name: "simulate-busy" }));
    expect((screen.getByLabelText("Land") as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Choose another land",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Load more" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  describe("account isolation", () => {
    const c1 = "11111111-1111-4111-8111-111111111111";
    const c2 = "22222222-2222-4222-8222-222222222222";
    const pageFor = (owner: string, ids: string[]) => ({
      accountId: owner,
      items: ids.map((id) => ({
        id,
        label: `Land ${id.slice(0, 4)}`,
        geographyName: "Synthetic village",
      })),
      nextCursor: null,
    });
    const switchTo = () =>
      act(async () => void window.dispatchEvent(new Event("focus")));

    it("never shows a delayed land page of the previous account after an account switch", async () => {
      let releaseA: (value: unknown) => void = () => undefined;
      const land = vi
        .fn()
        .mockImplementationOnce(
          () => new Promise((resolve) => (releaseA = resolve)),
        )
        .mockResolvedValue(pageFor(accountB, [c2]));
      const sessionIdentity = vi
        .fn()
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockResolvedValue({ accountId: accountB, deviceId: "d" });
      mount(client({ land, sessionIdentity }));
      await waitFor(() => expect(land).toHaveBeenCalledTimes(1));
      await switchTo();
      await waitFor(() =>
        expect(screen.getAllByRole("option")).toHaveLength(2),
      );
      await act(async () => releaseA(pageFor(accountId, [c1])));
      const labels = screen.getAllByRole("option").map((o) => o.textContent);
      expect(labels.join("|")).toContain("Land 2222");
      expect(labels.join("|")).not.toContain("Land 1111");
    });

    it("refuses a land page or geometry read that belongs to another account", async () => {
      mount(
        client({ land: vi.fn().mockResolvedValue(pageFor(accountB, [c1])) }),
      );
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Sign in",
      );
      expect(screen.queryByLabelText("Land")).toBeNull();
      cleanup();
      const user = mount(
        client({
          landGeometry: vi.fn().mockResolvedValue({
            accountId: accountB,
            current: { version: 9, calculatedAreaM2: 1 },
          }),
        }),
      );
      await user.selectOptions(await screen.findByLabelText("Land"), a);
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Sign in",
      );
      expect(screen.queryByTestId("walk")).toBeNull();
      expect(screen.queryByLabelText("Land")).toBeNull();
    });

    it("drops a delayed geometry read and unmounts the survey when another account signs in", async () => {
      let releaseGeometry: (value: unknown) => void = () => undefined;
      const landGeometry = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => (releaseGeometry = resolve)),
        );
      const sessionIdentity = vi
        .fn()
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockResolvedValue({ accountId: accountB, deviceId: "d" });
      const land = vi
        .fn()
        .mockResolvedValueOnce(pageFor(accountId, [c1]))
        .mockResolvedValue(pageFor(accountB, [c2]));
      const user = mount(client({ landGeometry, sessionIdentity, land }));
      await user.selectOptions(await screen.findByLabelText("Land"), c1);
      await waitFor(() => expect(landGeometry).toHaveBeenCalledTimes(1));
      await switchTo();
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("option")
            .map((o) => o.textContent)
            .join("|"),
        ).toContain("Land 2222"),
      );
      await act(async () =>
        releaseGeometry({
          accountId,
          current: { version: 5, calculatedAreaM2: 1 },
        }),
      );
      expect(screen.queryByTestId("walk")).toBeNull();
      expect(
        screen
          .getAllByRole("option")
          .map((o) => o.textContent)
          .join("|"),
      ).not.toContain("Land 1111");
    });

    it("removes a mounted survey and the previous account's lands when the session switches", async () => {
      const sessionIdentity = vi
        .fn()
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockResolvedValue({ accountId: accountB, deviceId: "d" });
      const land = vi
        .fn()
        .mockResolvedValueOnce(pageFor(accountId, [c1]))
        .mockResolvedValue(pageFor(accountB, [c2]));
      const user = mount(client({ sessionIdentity, land }));
      await user.selectOptions(await screen.findByLabelText("Land"), c1);
      await screen.findByTestId("walk");
      await switchTo();
      await waitFor(() => expect(screen.queryByTestId("walk")).toBeNull());
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("option")
            .map((o) => o.textContent)
            .join("|"),
        ).toContain("Land 2222"),
      );
      expect(screen.queryByText(/Land 1111/)).toBeNull();
    });

    it("clears the picker on sign-out, but keeps an in-progress survey and says so", async () => {
      const sessionIdentity = vi
        .fn()
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockRejectedValueOnce(new PilotRequestError(401));
      mount(client({ sessionIdentity }));
      await screen.findByLabelText("Land");
      await switchTo();
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Sign in",
      );
      expect(screen.queryByLabelText("Land")).toBeNull();
      cleanup();
      const si = vi
        .fn()
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockRejectedValueOnce(new PilotRequestError(401))
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockResolvedValue({ accountId: accountB, deviceId: "d" });
      const user = mount(client({ sessionIdentity: si }));
      await user.selectOptions(await screen.findByLabelText("Land"), a);
      await screen.findByTestId("walk");
      await switchTo();
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Your survey on this screen is kept",
      );
      expect(screen.getByTestId("walk")).toBeTruthy();
      await switchTo();
      await waitFor(() =>
        expect(
          screen.queryByText(/Your survey on this screen is kept/),
        ).toBeNull(),
      );
      expect(screen.getByTestId("walk")).toBeTruthy();
      await switchTo();
      await waitFor(() => expect(screen.queryByTestId("walk")).toBeNull());
    });

    it("re-checks the signed-in account when a land is chosen, even if the geometry response looks valid", async () => {
      const sessionIdentity = vi
        .fn()
        .mockResolvedValueOnce({ accountId, deviceId: "d" })
        .mockResolvedValue({ accountId: accountB, deviceId: "d" });
      const land = vi
        .fn()
        .mockResolvedValueOnce(pageFor(accountId, [c1]))
        .mockResolvedValue(pageFor(accountB, [c2]));
      const landGeometry = vi.fn().mockResolvedValue({
        accountId,
        current: { version: 4, calculatedAreaM2: 1 },
      });
      const user = mount(client({ sessionIdentity, land, landGeometry }));
      await user.selectOptions(await screen.findByLabelText("Land"), c1);
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("option")
            .map((o) => o.textContent)
            .join("|"),
        ).toContain("Land 2222"),
      );
      expect(screen.queryByTestId("walk")).toBeNull();
      expect(landGeometry).not.toHaveBeenCalled();
    });
    it("aborts in-flight requests when the page is left", async () => {
      let signal: AbortSignal | undefined;
      const land = vi
        .fn()
        .mockImplementation((_after: unknown, s: AbortSignal) => {
          signal = s;
          return new Promise(() => undefined);
        });
      mount(client({ land }));
      await waitFor(() => expect(signal).toBeDefined());
      expect(signal?.aborted).toBe(false);
      cleanup();
      expect(signal?.aborted).toBe(true);
    });
  });
});
