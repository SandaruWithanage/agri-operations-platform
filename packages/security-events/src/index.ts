import { createHmac } from "node:crypto";

/**
 * Privacy-safe structured security events (SEC-A2, docs/security/SECURITY_EVENTS.md).
 *
 * Design rules, each enforced in code and covered by tests/security-events.test.ts:
 *
 * 1. **No free text.** An event is built only from fixed fields. Every string field is a member of a closed list
 *    (event, outcome, route class, reason) or, for `detail`, a `VARIABLE:reason` code. A value that is not on its
 *    list drops the whole event; nothing a caller supplies is copied through.
 * 2. **No raw identifiers.** Account, client and device values are replaced by a keyed hash (HMAC-SHA256 with a
 *    secret key, separate per field) and are omitted entirely when no key is configured. Raw addresses, ids,
 *    names, tokens, cookies, keys, locations and farmer data never reach the output.
 * 3. **Never break the caller.** Emission failures (a bad sink, an invalid event) are swallowed and counted.
 * 4. **Bounded volume.** A flood must not become a log flood: repeated identical events inside a window are
 *    coalesced into one line carrying a `count`. Counters always count every occurrence.
 * 5. **Low-cardinality metrics.** Counters are keyed by event and outcome only, never by an identifier.
 */

export const securityEventNames = [
  "bff.ratelimit.exceeded",
  "bff.origin.rejected",
  "bff.csrf.rejected",
  "config.unsafe.detected",
] as const;
export type SecurityEventName = (typeof securityEventNames)[number];

export const securityEventOutcomes = ["refused", "detected"] as const;
export type SecurityEventOutcome = (typeof securityEventOutcomes)[number];

export const securityRouteClasses = [
  "anonymous",
  "session-read",
  "session-write",
  "other",
] as const;
export type SecurityRouteClass = (typeof securityRouteClasses)[number];

export const securityReasons = [
  "client-budget",
  "unattributed-budget",
  "session-budget",
  "origin-mismatch",
  "cross-site-fetch",
  "csrf-format",
  "unsafe-configuration",
] as const;
export type SecurityReason = (typeof securityReasons)[number];

export type SecurityEventInput = {
  event: SecurityEventName;
  outcome: SecurityEventOutcome;
  routeClass?: SecurityRouteClass;
  reason?: SecurityReason;
  /** Raw values: hashed with the configured key before output, or omitted without a key. Never emitted raw. */
  account?: string;
  client?: string;
  device?: string;
  /** Only for `config.unsafe.detected`: `VARIABLE:reason` codes, never values. */
  detail?: readonly string[];
};

export type SecurityEventSink = (line: string) => void;

export type SecurityEventSnapshot = {
  /** Every occurrence by `event|outcome`, including coalesced ones. */
  events: Record<string, number>;
  /** Occurrences counted but not yet written to the log (waiting for the coalescing window to close). */
  pending: number;
  /** Events dropped because they were invalid or the sink failed. */
  dropped: number;
};

export interface SecurityEvents {
  emit(input: SecurityEventInput): void;
  /**
   * Writes every pending coalesced count now, one bounded line per coalescing key. Called on a timer and when the
   * process ends, so a burst that stops (or a process that is recycled) is still fully represented in the log.
   */
  flush(): void;
  snapshot(): SecurityEventSnapshot;
}

export type SecurityEventsOptions = {
  sink?: SecurityEventSink;
  /** Secret used to hash identifiers; at least 32 characters, or identifiers are omitted. */
  hashKey?: string;
  now?: () => number;
  /** Identical events inside this window are coalesced. 0 disables coalescing. */
  coalesceMs?: number;
  /** Upper bound on remembered coalescing keys. */
  maxKeys?: number;
};

const detailPattern = /^[A-Z][A-Z0-9_]{0,63}:[a-z][a-z-]{0,47}$/;
const maxDetail = 8;
const minimumKeyLength = 32;

const member = <T extends string>(
  list: readonly T[],
  value: unknown,
): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

export function createSecurityEvents(
  options: SecurityEventsOptions = {},
): SecurityEvents {
  const now = options.now ?? (() => Date.now());
  const sink = options.sink ?? (() => undefined);
  const coalesceMs = options.coalesceMs ?? 10_000;
  const maxKeys = options.maxKeys ?? 2048;
  const key =
    typeof options.hashKey === "string" &&
    options.hashKey.length >= minimumKeyLength
      ? options.hashKey
      : undefined;
  const counters = new Map<string, number>();
  type Window = {
    startedAt: number;
    suppressed: number;
    /** The fixed, already-hashed fields of the first event in the window (never raw identifiers). */
    fields: Record<string, unknown>;
  };
  const windows = new Map<string, Window>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dropped = 0;

  function keyed(field: string, value: unknown): string | undefined {
    if (!key || typeof value !== "string" || value === "" || value.length > 200)
      return undefined;
    return createHmac("sha256", key)
      .update(`${field}\u0000${value}`)
      .digest("base64url")
      .slice(0, 22);
  }

  function write(fields: Record<string, unknown>, at: number, count: number) {
    const { v, event, outcome, ...rest } = fields;
    const line: Record<string, unknown> = {
      v,
      event,
      time: new Date(at).toISOString(),
      outcome,
      ...rest,
    };
    if (count > 1) line.count = count;
    sink(JSON.stringify(line));
  }

  /** Writes what a window counted but never logged, and resets it. */
  function writePending(window: Window, at: number) {
    if (window.suppressed === 0) return;
    const pending = window.suppressed;
    window.suppressed = 0;
    write(window.fields, at, pending);
  }

  function hasPending(): boolean {
    for (const window of windows.values())
      if (window.suppressed > 0) return true;
    return false;
  }

  /** One timer for all keys, never keeping the process alive; it re-arms only while counts are pending. */
  function arm() {
    if (timer !== undefined || coalesceMs <= 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      flushWindows(false);
      if (hasPending()) arm();
    }, coalesceMs);
    (timer as { unref?: () => void }).unref?.();
  }

  function flushWindows(all: boolean) {
    try {
      const at = now();
      for (const [key, window] of windows) {
        const expired = at - window.startedAt >= coalesceMs;
        if (!all && !expired) continue;
        writePending(window, at);
        if (expired) windows.delete(key);
      }
    } catch {
      dropped += 1;
    }
  }

  function emit(input: SecurityEventInput): void {
    try {
      if (
        !member(securityEventNames, input?.event) ||
        !member(securityEventOutcomes, input.outcome) ||
        (input.routeClass !== undefined &&
          !member(securityRouteClasses, input.routeClass)) ||
        (input.reason !== undefined && !member(securityReasons, input.reason))
      ) {
        dropped += 1;
        return;
      }
      let detail: string[] | undefined;
      if (input.detail !== undefined) {
        if (
          input.event !== "config.unsafe.detected" ||
          !Array.isArray(input.detail) ||
          input.detail.length === 0 ||
          input.detail.length > maxDetail ||
          !input.detail.every(
            (code) => typeof code === "string" && detailPattern.test(code),
          )
        ) {
          dropped += 1;
          return;
        }
        detail = [...input.detail];
      }
      const account = keyed("account", input.account);
      const client = keyed("client", input.client);
      const device = keyed("device", input.device);
      const counterKey = `${input.event}|${input.outcome}`;
      counters.set(counterKey, (counters.get(counterKey) ?? 0) + 1);

      const at = now();
      // Fixed key order and fixed keys only: nothing from `input` is copied through.
      const fields: Record<string, unknown> = {
        v: 1,
        event: input.event,
        outcome: input.outcome,
      };
      if (input.routeClass) fields.routeClass = input.routeClass;
      if (input.reason) fields.reason = input.reason;
      if (account) fields.account = account;
      if (client) fields.client = client;
      if (device) fields.device = device;
      if (detail) fields.detail = detail;

      let count = 1;
      if (coalesceMs > 0 && input.event !== "config.unsafe.detected") {
        const windowKey = [
          input.event,
          input.outcome,
          input.routeClass ?? "",
          input.reason ?? "",
          client ?? "",
          account ?? "",
          device ?? "",
        ].join("|");
        const existing = windows.get(windowKey);
        if (existing && at - existing.startedAt < coalesceMs) {
          existing.suppressed += 1;
          arm();
          return;
        }
        count = 1 + (existing?.suppressed ?? 0);
        if (windows.size >= maxKeys && !existing) {
          // Evicting a key must not lose what it had counted: write its pending count first.
          const oldest = windows.entries().next().value;
          if (oldest !== undefined) {
            writePending(oldest[1], at);
            windows.delete(oldest[0]);
          }
        }
        windows.delete(windowKey);
        windows.set(windowKey, { startedAt: at, suppressed: 0, fields });
      }
      write(fields, at, count);
    } catch {
      dropped += 1;
    }
  }

  return {
    emit,
    flush: () => flushWindows(true),
    snapshot: () => {
      let pending = 0;
      for (const window of windows.values()) pending += window.suppressed;
      return { events: Object.fromEntries(counters), pending, dropped };
    },
  };
}

let shared: SecurityEvents | undefined;

/**
 * The process-wide emitter: one JSON line per event on standard output, hashed with
 * `SECURITY_EVENT_HASH_KEY` when that is set to at least 32 characters. Without the key events are still emitted
 * but carry no account, client or device identifier, which also means client-level detection is not possible.
 */
export function getSecurityEvents(): SecurityEvents {
  if (!shared) {
    const created = createSecurityEvents({
      sink: (line) => {
        process.stdout.write(line + "\n");
      },
      hashKey: process.env.SECURITY_EVENT_HASH_KEY,
    });
    // Orderly shutdown and exit write the counts still waiting for their window to close. A hard kill (SIGKILL,
    // or SIGTERM with no handler) bypasses both, which is why the timer also bounds the loss to one window.
    process.once("beforeExit", () => created.flush());
    process.once("exit", () => created.flush());
    shared = created;
  }
  return shared;
}

/** Test hook: replace or reset the process-wide emitter. */
export function setSecurityEventsForTests(value: SecurityEvents | undefined) {
  shared = value;
}
