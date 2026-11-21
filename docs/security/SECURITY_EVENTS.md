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

## Production requirement: `SECURITY_EVENT_HASH_KEY`

Where client or account correlation is needed (spraying across accounts, one client against many accounts, repeat offenders, incident investigation), a **securely managed** `SECURITY_EVENT_HASH_KEY` is a production requirement. Without it the events still carry the event, route class and reason, but no identifier, so the same source cannot be recognised across events. That is a safe degradation, not a working detection setup. Status: **requirement documented; key custody is not decided** (it follows the hosting decision, OPS-04).

Requirements for the key:

- At least 32 characters from a cryptographically secure random generator (for example 32 random bytes, encoded). A shorter or absent value is ignored and identifiers are omitted.
- Held in a managed secret store or the platform's secret environment, injected at process start, readable only by the processes that emit events and by the people who administer them. **One value per environment**; never shared with a development, test or pilot environment, and never reused as another secret (for example the BFF internal key).
- Never in the repository, in a committed `.env`, in a pull request, ticket or chat, in a prompt, in a log line or in a configuration error. The code never prints it (tested), and the SEC-A9 scanner is a backstop, not the control.
- **Rotation** replaces the key and deliberately breaks correlation across the change: identifiers hashed under the old key no longer match those under the new one. Record the rotation time in the operational log so an investigation knows where the boundary is. There is no overlapping-key support. Rotate on any suspected exposure and on a schedule the operator sets.
- **Exposure:** the hashes are not reversible, but values with little entropy (an address, a short login name) could be tested against a leaked key. Treat stored events from the exposure period as potentially re-identifiable by anyone holding both the key and the logs, rotate, and handle it as a security incident (the incident owner is pending assignment, OWNER-S5).
- Access to the log stream that holds the hashed identifiers is restricted in the same way as for the key, because the two together are the sensitive combination.

What is deliberately **not** done here: the start-up check (SEC-A1) does not require this variable, so a production start without it succeeds and logs no identifiers. Making the key mandatory in production is a possible follow-up for the owner to decide; it would change start-up behaviour and is not part of this change. Nothing here claims that a key is deployed, that custody is solved or that the events are production-proven.

## Operating notes

- **Collection:** one JSON line per event on standard output. The platform's log collector, retention and access control are part of the hosting decision (OPS-04, not made). Treat the stream as sensitive-by-association: it contains hashed identifiers and abuse signals, so restrict who can read it.
- **Alerting and recipients:** alert rules and incident routing are designed in SEC-A7. The operational recipient is **pending assignment** (OWNER-S5). Thresholds are provisional and unmeasured.
- **Read-volume protection** is measurement and detection first, with no per-day limit (OWNER-S4). This slice provides the refusal signals; usage-volume measurement comes with the API and data-read events.
- **Process-local:** counters and coalescing are per process. With several instances each keeps its own; aggregate in the log pipeline.

## Verification (synthetic)

21 automated tests: closed field lists, planted-secret redaction (passwords, one-time codes, cookies, bearer tokens, internal keys, names, coordinates, national identifiers, addresses, ids), keyed hashing (deterministic per key, different across keys, omitted without a key), configuration detail validation, never-throw behaviour, flood coalescing with exact counts, bounded memory, low-cardinality metrics, BFF emission with unchanged responses, a broken emitter not changing any response, and wiring guards. Five mutation checks (copy unknown fields, emit a raw identifier, no coalescing, propagate sink errors, remove the rate-limit emission) each fail the suite. Real server runs confirmed the output and that none of a planted address, password, cookie, origin, internal key or hash key appears.

## Not proven

Behaviour under production load, log-pipeline loss, key custody and rotation, and whether the coalescing window and the event set are right for operations. These need the benchmark, the hosting decision and independent review.
