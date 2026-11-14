// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerEvent = {
  waitUntil?: (value: Promise<unknown>) => void;
  request?: { mode: string; url: string };
  respondWith?: ReturnType<typeof vi.fn>;
};

function worker(
  network: ReturnType<typeof vi.fn>,
  cacheMatch: ReturnType<typeof vi.fn>,
) {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const cacheAdd = vi.fn().mockResolvedValue(undefined);
  const caches = {
    open: vi.fn().mockResolvedValue({ add: cacheAdd }),
    match: cacheMatch,
    keys: vi.fn().mockResolvedValue([]),
  };
  runInNewContext(readFileSync("apps/field-pwa/public/sw.js", "utf8"), {
    self: {
      location: { origin: "https://field.example" },
      addEventListener: (
        name: string,
        callback: (event: WorkerEvent) => void,
      ) => handlers.set(name, callback),
    },
    URL,
    caches,
    fetch: network,
    Promise,
  });
  return { handlers, cacheAdd };
}

describe("field offline fallback", () => {
  it("pre-caches only the public offline page on install", async () => {
    const { handlers, cacheAdd } = worker(vi.fn(), vi.fn());
    let pending: Promise<unknown> | undefined;
    handlers.get("install")!({
      waitUntil: (value: Promise<unknown>) => {
        pending = value;
      },
    });
    await pending;
    expect(cacheAdd).toHaveBeenCalledExactlyOnceWith("/offline.html");
  });
  it("falls back for offline navigation but does not cache API or cross-origin requests", async () => {
    const fallback = { page: "offline" };
    const network = vi.fn().mockRejectedValue(new Error("offline"));
    const cacheMatch = vi.fn().mockResolvedValue(fallback);
    const { handlers } = worker(network, cacheMatch);
    const respondWith = vi.fn();
    const fetchEvent = handlers.get("fetch")!;
    fetchEvent({
      request: { mode: "navigate", url: "https://field.example/" },
      respondWith,
    });
    expect(await respondWith.mock.calls[0][0]).toBe(fallback);
    expect(cacheMatch).toHaveBeenCalledExactlyOnceWith("/offline.html");
    respondWith.mockClear();
    fetchEvent({
      request: { mode: "cors", url: "https://field.example/api/farmers" },
      respondWith,
    });
    fetchEvent({
      request: { mode: "navigate", url: "https://elsewhere.example/" },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(1);
  });
});
