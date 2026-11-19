# Security events (SEC-A2)

Status: **implemented for the BFF and its start-up check; API and sign-in events are the next slice (SEC-A2b).** Engineering evidence from synthetic tests and local runs only; nothing here is production-proven. Internal review, not independent. Related: [threat model](THREAT_MODEL_AUTOMATED_THREATS.md) (section 4), [audit](SECURITY_BASELINE_AUDIT.md) (finding F-04), owner directions OWNER-S4, S5 and S9 in the [decision register](../requirements/OPEN_DECISIONS.md).

## What it is, and what it is not

A small, dependency-free emitter (`@agri/security-events`) that writes **one JSON line per security-relevant refusal** to standard output, for the platform's log collection to pick up. It is operational telemetry for detecting abuse. It is **not** the business audit trail, not an access log, and not a place for any data about people.

## Privacy rules (enforced in code and tests)

| Rule                               | How it is enforced                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No free text                       | An event is built only from fixed fields. `event`, `outcome`, `routeClass` and `reason` must be members of closed lists; anything else drops the whole event. Nothing a caller supplies is copied through.                                                                                                                                                                                       |
| No raw identifiers                 | Account, client and device values become a **keyed hash** (HMAC-SHA256 with a secret key, one derivation per field, 22 characters) or are omitted. A raw address, id, name, token, cookie, key, location or farmer data never reaches the output.                                                                                                                                                |
| No key, no identifiers             | If `SECURITY_EVENT_HASH_KEY` is unset or shorter than 32 characters, events are still emitted but carry no identifier. Client-level detection then is not possible, so **setting the key is recommended**. Never commit a value; supply it through a secret environment.                                                                                                                         |
| Configuration detail is codes only | `config.unsafe.detected` carries `VARIABLE:reason` codes (for example `PILOT_TRUSTED_PROXY_HOPS:missing`). A value, or anything not matching that shape, is dropped.                                                                                                                                                                                                                             |
| Never breaks the caller            | A failing sink or an invalid event is swallowed and counted in `dropped`. The response a client receives is unchanged.                                                                                                                                                                                                                                                                           |
| Bounded volume                     | Identical events inside a window (default 10 s, per event, route class, reason and hashed identifiers) are **coalesced into one line with a `count`**, with a memory bound on remembered keys. Counters still count every occurrence. A flood cannot become a log flood from one source; many distinct sources can still produce many lines, which is why the metrics and the edge limit matter. |
| Low-cardinality metrics            | Counters are keyed by event and outcome only, never by an identifier.                                                                                                                                                                                                                                                                                                                            |

A hashed identifier is stable for one key, so the same client can be correlated across events while the key is unchanged. It cannot be reversed without the key. Rotating the key breaks correlation with earlier events, which is intended and should be recorded in the runbook.

## Line format (version 1)

```json
{
  "v": 1,
  "event": "bff.ratelimit.exceeded",
  "time": "2026-11-19T09:39:48.027Z",
  "outcome": "refused",
  "routeClass": "anonymous",
  "reason": "client-budget",
  "client": "stbHlFsBd3AiaPt0KsL3Zu",
  "count": 42
}
```

Fixed key order; `routeClass`, `reason`, `account`, `client`, `device`, `detail` and `count` appear only when present.

## Implemented events

| Event                    | Where                                                                     | Outcome    | Reasons                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `bff.ratelimit.exceeded` | BFF, when a request budget refuses a request                              | `refused`  | `client-budget`, `unattributed-budget`, `session-budget` (route class `anonymous`, `session-read` or `session-write`) |
| `bff.origin.rejected`    | BFF, wrong `Origin` or a cross-site fetch                                 | `refused`  | `origin-mismatch`, `cross-site-fetch`                                                                                 |
| `bff.csrf.rejected`      | BFF, a malformed CSRF token on a write                                    | `refused`  | `csrf-format`                                                                                                         |
| `config.unsafe.detected` | Admin web and field PWA start-up check (SEC-A1), before the process exits | `detected` | `unsafe-configuration` plus `detail` codes                                                                            |

## Planned (not implemented; do not assume they exist)

`auth.login.failed` and `auth.login.throttled` (reason codes that do not reveal whether an account exists), `auth.mfa.failed`, `auth.device.rejected`, `auth.session.revoked`, `auth.device.revoked`, `api.overload.shed`, `db.statement.timeout`, `db.pool.exhausted`, `data.read.volume`, and the capabilities events in the contract. Sign-in and API events touch the authentication path and the API build, so they are a separate, separately reviewed slice (SEC-A2b).

## Operating notes

- **Collection:** one JSON line per event on standard output. The platform's log collector, retention and access control are part of the hosting decision (OPS-04, not made). Treat the stream as sensitive-by-association: it contains hashed identifiers and abuse signals, so restrict who can read it.
- **Alerting and recipients:** alert rules and incident routing are designed in SEC-A7. The operational recipient is **pending assignment** (OWNER-S5). Thresholds are provisional and unmeasured.
- **Read-volume protection** is measurement and detection first, with no per-day limit (OWNER-S4). This slice provides the refusal signals; usage-volume measurement comes with the API and data-read events.
- **Process-local:** counters and coalescing are per process. With several instances each keeps its own; aggregate in the log pipeline.

## Verification (synthetic)

21 automated tests: closed field lists, planted-secret redaction (passwords, one-time codes, cookies, bearer tokens, internal keys, names, coordinates, national identifiers, addresses, ids), keyed hashing (deterministic per key, different across keys, omitted without a key), configuration detail validation, never-throw behaviour, flood coalescing with exact counts, bounded memory, low-cardinality metrics, BFF emission with unchanged responses, a broken emitter not changing any response, and wiring guards. Five mutation checks (copy unknown fields, emit a raw identifier, no coalescing, propagate sink errors, remove the rate-limit emission) each fail the suite. Real server runs confirmed the output and that none of a planted address, password, cookie, origin, internal key or hash key appears.

## Not proven

Behaviour under production load, log-pipeline loss, key custody and rotation, and whether the coalescing window and the event set are right for operations. These need the benchmark, the hosting decision and independent review.
