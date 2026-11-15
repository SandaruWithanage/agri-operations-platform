// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
type Event = {
  waitUntil?: (value: Promise<unknown>) => void;
  request?: { method: string; mode: string; url: string };
  respondWith?: ReturnType<typeof vi.fn>;
  data?: unknown;
  ports?: unknown[];
};
function worker(
  network: ReturnType<typeof vi.fn>,
  match = vi.fn().mockResolvedValue(undefined),
) {
  const handlers = new Map<string, (event: Event) => void>();
  const add = vi.fn().mockResolvedValue(undefined);
  const put = vi.fn().mockResolvedValue(undefined);
  const cache = { add, put, match };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  runInNewContext(readFileSync("apps/field-pwa/public/sw.js", "utf8"), {
    self: {
      location: { origin: "https://field.example" },
      addEventListener: (name: string, callback: (event: Event) => void) =>
        handlers.set(name, callback),
    },
    URL,
    Request,
    Set,
    caches,
    fetch: network,
    Promise,
  });
  return { handlers, cache, caches };
}
describe("public offline application shell", () => {
  it("prepares only the explicitly marked public shell, fallback and public build assets without credentials", async () => {
    const network = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '<script src="/_next/static/chunks/public.js"></script><link href="/api/private"><script src="https://elsewhere.example/_next/static/private.js"></script>',
          { headers: { "x-agri-public-shell": "1" } },
        ),
      );
    const { handlers, cache } = worker(network);
    let pending: Promise<unknown> | undefined;
    handlers.get("install")!({
      waitUntil: (value) => {
        pending = value;
      },
    });
    await pending;
    expect(cache.add.mock.calls).toHaveLength(2);
    expect(cache.add.mock.calls[0][0]).toBe("/offline.html");
    expect(cache.add.mock.calls[1][0].url).toBe(
      "https://field.example/_next/static/chunks/public.js",
    );
    expect(cache.add.mock.calls[1][0].credentials).toBe("omit");
    expect(network.mock.calls[0][0].credentials).toBe("omit");
    expect(cache.put.mock.calls[0][0]).toBe("/offline-workspace");
  });
  it("refuses to install an unmarked/private application page", async () => {
    const { handlers, cache } = worker(
      vi
        .fn()
        .mockResolvedValue(
          new Response('<script src="/_next/static/public.js"></script>'),
        ),
    );
    let pending: Promise<unknown> | undefined;
    handlers.get("install")!({
      waitUntil: (value) => {
        pending = value;
      },
    });
    await expect(pending).rejects.toThrow("Public shell");
    expect(cache.put).not.toHaveBeenCalled();
  });
  it("serves the saved shell for offline navigation while leaving APIs, private JSON and cross-origin requests untouched", async () => {
    const page = { public: true };
    const network = vi.fn().mockRejectedValue(new Error("offline"));
    const match = vi.fn().mockResolvedValue(page);
    const { handlers } = worker(network, match);
    const respondWith = vi.fn();
    const dispatch = handlers.get("fetch")!;
    dispatch({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://field.example/offline-workspace",
      },
      respondWith,
    });
    expect(await respondWith.mock.calls[0][0]).toBe(page);
    expect(match).toHaveBeenCalledWith("/offline-workspace");
    respondWith.mockClear();
    for (const request of [
      {
        method: "GET",
        mode: "cors",
        url: "https://field.example/api/pilot/auth/csrf",
      },
      {
        method: "POST",
        mode: "navigate",
        url: "https://field.example/api/pilot/farmers/register",
      },
      {
        method: "GET",
        mode: "cors",
        url: "https://field.example/_next/static/private.json",
      },
      { method: "GET", mode: "navigate", url: "https://elsewhere.example/" },
    ])
      dispatch({ request, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledOnce();
  });
  it("does not preserve request credentials or query parameters when caching public static assets", async () => {
    const network = vi.fn().mockResolvedValue(new Response("// public"));
    const { handlers, cache } = worker(network);
    const respondWith = vi.fn();
    handlers.get("fetch")!({
      request: {
        method: "GET",
        mode: "cors",
        url: "https://field.example/_next/static/public.js?private-query=synthetic",
      },
      respondWith,
    });
    await respondWith.mock.calls[0][0];
    const key = cache.put.mock.calls[0][0] as Request;
    expect(key.url).toBe("https://field.example/_next/static/public.js");
    expect(key.credentials).toBe("omit");
    expect(key.headers.has("authorization")).toBe(false);
  });
});
