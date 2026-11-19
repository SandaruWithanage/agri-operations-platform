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
  /** Events dropped because they were invalid or the sink failed. */
  dropped: number;
};

export interface SecurityEvents {
  emit(input: SecurityEventInput): void;
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
  const windows = new Map<string, { startedAt: number; suppressed: number }>();
  let dropped = 0;

  function keyed(field: string, value: unknown): string | undefined {
    if (!key || typeof value !== "string" || value === "" || value.length > 200)
      return undefined;
    return createHmac("sha256", key)
      .update(`${field}\u0000${value}`)
      .digest("base64url")
      .slice(0, 22);
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
          return;
        }
        count = 1 + (existing?.suppressed ?? 0);
        if (windows.size >= maxKeys && !existing) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
        windows.delete(windowKey);
        windows.set(windowKey, { startedAt: at, suppressed: 0 });
      }

      // Fixed key order and fixed keys only: nothing from `input` is copied through.
      const line: Record<string, unknown> = {
        v: 1,
        event: input.event,
        time: new Date(at).toISOString(),
        outcome: input.outcome,
      };
      if (input.routeClass) line.routeClass = input.routeClass;
      if (input.reason) line.reason = input.reason;
      if (account) line.account = account;
      if (client) line.client = client;
      if (device) line.device = device;
      if (detail) line.detail = detail;
      if (count > 1) line.count = count;
      sink(JSON.stringify(line));
    } catch {
      dropped += 1;
    }
  }

  return {
    emit,
    snapshot: () => ({
      events: Object.fromEntries(counters),
      dropped,
    }),
  };
}

let shared: SecurityEvents | undefined;

/**
 * The process-wide emitter: one JSON line per event on standard output, hashed with
 * `SECURITY_EVENT_HASH_KEY` when that is set to at least 32 characters. Without the key events are still emitted
 * but carry no account, client or device identifier, which also means client-level detection is not possible.
 */
export function getSecurityEvents(): SecurityEvents {
  shared ??= createSecurityEvents({
    sink: (line) => {
      process.stdout.write(line + "\n");
    },
    hashKey: process.env.SECURITY_EVENT_HASH_KEY,
  });
  return shared;
}

/** Test hook: replace or reset the process-wide emitter. */
export function setSecurityEventsForTests(value: SecurityEvents | undefined) {
  shared = value;
}
