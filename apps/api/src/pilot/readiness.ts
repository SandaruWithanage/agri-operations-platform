/** Share probes without overlapping a timed-out batch that is still settling. */
export class RuntimeReadiness {
  private pending: Promise<boolean> | undefined;
  private cached: { ready: boolean; until: number } | undefined;
  private stopped = false;
  constructor(private readonly probes: Array<() => Promise<boolean>>) {}
  check(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (this.cached && performance.now() < this.cached.until)
      return Promise.resolve(this.cached.ready);
    if (this.pending) return this.pending;
    let timer: ReturnType<typeof setTimeout>;
    const work = Promise.allSettled(
      this.probes.map((probe) => Promise.resolve().then(probe)),
    ).then(
      (results) =>
        results.length > 0 &&
        results.every(
          (result) => result.status === "fulfilled" && result.value === true,
        ),
    );
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 2000);
      timer.unref?.();
    });
    const response = Promise.race([work, deadline]).then((ready) => {
      clearTimeout(timer);
      if (this.stopped) return false;
      this.cached = { ready, until: performance.now() + 2000 };
      return ready;
    });
    this.pending = response;
    // A response timeout does not cancel pg work. Keep sharing the failed response
    // until the entire batch settles, avoiding repeated queued connection attempts.
    void work.then(() => {
      if (this.pending === response) this.pending = undefined;
    });
    return response;
  }
  stop() {
    this.stopped = true;
    this.cached = undefined;
  }
}
