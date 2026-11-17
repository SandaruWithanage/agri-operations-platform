import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalkSurveyScreen } from "../apps/field-pwa/components/walk-survey-screen";

// Minimal DOM matchers; the repository does not load jest-dom.
declare module "vitest" {
  interface Assertion {
    toHaveTextContent(text: string): void;
    toBeInTheDocument(): void;
    toBeDisabled(): void;
    toBeEnabled(): void;
  }
}
expect.extend({
  toHaveTextContent(received: Element, text: string) {
    const actual = received.textContent ?? "";
    return {
      pass: actual.includes(text),
      message: () => `expected "${actual}" to contain "${text}"`,
    };
  },
  toBeInTheDocument(received: Element) {
    return {
      pass: received?.isConnected === true,
      message: () => "expected element to be in the document",
    };
  },
  toBeDisabled(received: HTMLButtonElement) {
    return {
      pass: received.disabled === true,
      message: () => "expected element to be disabled",
    };
  },
  toBeEnabled(received: HTMLButtonElement) {
    return {
      pass: received.disabled === false,
      message: () => "expected element to be enabled",
    };
  },
});

const accountId = "a50456eb-af66-41f0-8c38-0bc827249cd2";
const landId = "06149451-4004-4a23-a5a2-64a24e485a82";
const t0 = 1_800_000_000_000;
const corners = [
  [80.2, 8.3],
  [80.201, 8.3],
  [80.201, 8.301],
  [80.2, 8.301],
];
function walk(sides = 4) {
  const out: { lon: number; lat: number; ts: number }[] = [];
  let k = 0;
  for (let s = 0; s < sides; s += 1) {
    const [a, b] = [corners[s], corners[(s + 1) % 4]];
    for (let i = 0; i < 11; i += 1)
      out.push({
        lon: a[0] + ((b[0] - a[0]) * i) / 11,
        lat: a[1] + ((b[1] - a[1]) * i) / 11,
        ts: t0 + 7000 * k++,
      });
  }
  return out;
}
function fakeGeo() {
  let success: ((p: unknown) => void) | undefined;
  let failure: ((e: unknown) => void) | undefined;
  const watchPosition = vi.fn(
    (s: (p: unknown) => void, e: (x: unknown) => void) => {
      success = s;
      failure = e;
      return 7;
    },
  );
  const clearWatch = vi.fn();
  return {
    watchPosition,
    clearWatch,
    emit: (lon: number, lat: number, accuracy: number, ts: number) =>
      act(() =>
        success?.({
          coords: { longitude: lon, latitude: lat, accuracy },
          timestamp: ts,
        }),
      ),
    fail: (code: number) => act(() => failure?.({ code })),
  };
}
function setup(
  over: Partial<Parameters<typeof WalkSurveyScreen>[0]> = {},
  geo = fakeGeo(),
) {
  const client = {
    recordLandGeometry: vi.fn().mockResolvedValue({
      version: 1,
      replayed: false,
      calculatedAreaM2: 12000,
    }),
  };
  let n = 0;
  const newId = vi.fn(() => `00000000-0000-4000-8000-00000000000${++n}`);
  render(
    <WalkSurveyScreen
      language="en"
      accountId={accountId}
      landId={landId}
      expectedVersion={0}
      client={client}
      geolocation={geo as never}
      newId={newId}
      clock={() => t0}
      {...over}
    />,
  );
  return { geo, client, newId, user: userEvent.setup() };
}
async function walkAll(geo: ReturnType<typeof fakeGeo>, sides = 4) {
  for (const p of walk(sides)) await geo.emit(p.lon, p.lat, 5, p.ts);
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("walk survey screen", () => {
  it("does not touch location until the officer starts, and is disabled without geolocation", async () => {
    const { geo } = setup();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Start recording" }),
    ).toBeEnabled();
    cleanup();
    setup({ geolocation: null });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot provide location",
    );
    expect(
      screen.getByRole("button", { name: "Start recording" }),
    ).toBeDisabled();
  });

  it("records only while recording, ignores weak readings visibly, and releases location on pause, finish and unmount", async () => {
    const { geo, user } = setup();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition.mock.calls[0][2]).toMatchObject({
      enableHighAccuracy: true,
      maximumAge: 0,
    });
    const [first, second] = walk();
    await geo.emit(first.lon, first.lat, 5, first.ts);
    await geo.emit(second.lon, second.lat, 40, second.ts);
    expect(screen.getByRole("status")).toHaveTextContent("Points recorded: 1");
    expect(
      screen.getByText(/Weak or invalid readings ignored: 1/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    await geo.emit(second.lon, second.lat, 5, second.ts + 1000);
    expect(screen.getByRole("status")).toHaveTextContent("Points recorded: 1");
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Finish and review" }));
    expect(geo.clearWatch).toHaveBeenCalledTimes(2);
    cleanup();
    const other = setup();
    await other.user.click(
      screen.getByRole("button", { name: "Start recording" }),
    );
    cleanup();
    expect(other.geo.clearWatch).toHaveBeenCalledWith(7);
  });

  it("pauses and says so when the page is hidden", async () => {
    const { geo, user } = setup();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    expect(screen.getByRole("alert")).toHaveTextContent("recording was paused");
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(geo.clearWatch).toHaveBeenCalled();
  });

  it("shows denied location with a retry that restarts the watch", async () => {
    const { geo, user } = setup();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await geo.fail(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Location permission was denied",
    );
    await user.click(
      screen.getByRole("button", { name: "Try location again" }),
    );
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  });

  it("reviews a full walk and saves the validated closed ring with one idempotency id, even across a retry", async () => {
    const { geo, client, newId, user } = setup();
    client.recordLandGeometry.mockRejectedValueOnce({ status: 409 });
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await walkAll(geo);
    await user.click(screen.getByRole("button", { name: "Finish and review" }));
    expect(screen.getByText(/m² \(/)).toBeInTheDocument();
    expect(screen.getByText(/3\.0\d\d acres/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Save provisional polygon" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("polygon changed");
    await user.click(
      screen.getByRole("button", { name: "Save provisional polygon" }),
    );
    expect(client.recordLandGeometry).toHaveBeenCalledTimes(2);
    const [account, input] = client.recordLandGeometry.mock.calls[1];
    expect(account).toBe(accountId);
    expect(input).toMatchObject({
      landId,
      expectedVersion: 0,
      source: "gps_walk",
    });
    expect(input.ring[0]).toEqual(input.ring[input.ring.length - 1]);
    expect(client.recordLandGeometry.mock.calls[0][1].mutationId).toBe(
      input.mutationId,
    );
    expect(newId).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Saved on the server as a provisional polygon/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save provisional polygon" }),
    ).toBeDisabled();
  });

  it("blocks saving an unclosed outline and explains why", async () => {
    const { geo, client, user } = setup();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await walkAll(geo, 3);
    await user.click(screen.getByRole("button", { name: "Finish and review" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "too far from the first",
    );
    expect(
      screen.getByRole("button", { name: "Save provisional polygon" }),
    ).toBeDisabled();
    expect(client.recordLandGeometry).not.toHaveBeenCalled();
  });

  it("requires a reason before removing a point and discards cleanly", async () => {
    const { geo, user } = setup();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await walkAll(geo);
    await user.click(screen.getByRole("button", { name: "Finish and review" }));
    const remove = screen.getAllByRole("button", { name: "Remove point" })[0];
    expect(remove).toBeDisabled();
    await user.type(
      screen.getAllByLabelText("Reason (required)")[0],
      "Stood in a doorway",
    );
    expect(
      screen.getAllByRole("button", { name: "Remove point" })[0],
    ).toBeEnabled();
    await user.click(
      screen.getAllByRole("button", { name: "Remove point" })[0],
    );
    expect(
      screen.getAllByRole("button", { name: "Remove point" }),
    ).toHaveLength(43);
    await user.click(screen.getByRole("button", { name: "Discard survey" }));
    expect(
      screen.getByRole("button", { name: "Start recording" }),
    ).toBeInTheDocument();
  });

  it("renders in Sinhala with the provisional notice", () => {
    setup({ language: "si" });
    expect(
      screen.getByRole("button", { name: "වාර්තා කිරීම අරඹන්න" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/නීතිමය මැනුමක්/)).toBeInTheDocument();
  });
});
