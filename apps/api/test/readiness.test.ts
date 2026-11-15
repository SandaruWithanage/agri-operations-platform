// @vitest-environment node
import "reflect-metadata";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeReadiness } from "../src/pilot/readiness";
import { ReadinessController } from "../src/readiness.controller";
import type { PilotRuntime } from "../src/pilot/contracts";
afterEach(() => vi.useRealTimers());
it("requires every configured dependency and rejects an empty list", async () => {
  expect(
    await new RuntimeReadiness([async () => true, async () => true]).check(),
  ).toBe(true);
  expect(
    await new RuntimeReadiness([async () => true, async () => false]).check(),
  ).toBe(false);
  expect(
    await new RuntimeReadiness([
      async () => {
        throw new Error("private");
      },
    ]).check(),
  ).toBe(false);
  expect(await new RuntimeReadiness([]).check()).toBe(false);
});
it("shares concurrent probes and refreshes its short monotonic cache", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const probe = vi.fn().mockResolvedValue(true),
    readiness = new RuntimeReadiness([probe]);
  const first = readiness.check();
  expect(readiness.check()).toBe(first);
  expect(await first).toBe(true);
  expect(await readiness.check()).toBe(true);
  expect(probe).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2001);
  expect(await readiness.check()).toBe(true);
  expect(probe).toHaveBeenCalledTimes(2);
});
it("returns false at the deadline without creating overlapping probe batches", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  let finish!: (v: boolean) => void;
  const probe = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    ),
    readiness = new RuntimeReadiness([probe]);
  const first = readiness.check();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await first).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await readiness.check()).toBe(false);
  expect(probe).toHaveBeenCalledOnce();
  finish(true);
  await vi.advanceTimersByTimeAsync(0);
  probe.mockResolvedValue(true);
  expect(await readiness.check()).toBe(true);
  expect(probe).toHaveBeenCalledTimes(2);
});
it("never returns ready after shutdown even if an in-flight probe later succeeds", async () => {
  let finish!: (v: boolean) => void;
  const readiness = new RuntimeReadiness([
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  ]);
  const result = readiness.check();
  await Promise.resolve();
  readiness.stop();
  finish(true);
  expect(await result).toBe(false);
  expect(await readiness.check()).toBe(false);
});
it("sanitizes missing, failed and throwing runtime probes", async () => {
  for (const runtime of [
    null,
    { readiness: async () => false },
    {
      readiness: async () => {
        throw new Error("private database URL");
      },
    },
  ]) {
    const controller = new ReadinessController(runtime as PilotRuntime | null);
    await expect(controller.status()).rejects.toMatchObject({
      response: { status: "not-ready" },
      status: 503,
    });
  }
  expect(
    await new ReadinessController({
      readiness: async () => true,
    } as PilotRuntime).status(),
  ).toEqual({ status: "ready" });
});
