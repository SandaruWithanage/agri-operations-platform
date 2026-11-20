# Request and resource budgets (SEC-A4 design)

**Status: DESIGN ONLY, PROPOSED.** No code, configuration, threshold or production resource policy changes. **No new number in this document is adopted**: where a budget does not exist today it says "to be set from measurement". Existing values are quoted from the code as of 19 Nov 2026. This is not independently reviewed, and nothing here is Gate G1 approval or production security acceptance (Gate G1 and a qualified independent reviewer remain open, OWNER-S6 and S13).

Owner directions it follows: the D2 login limits stay provisional until synthetic load tests (S1); read-volume protection is measurement and detection first, **with no per-day limits** (S4); capability budgets, the 60 s lifetime and thresholds stay provisional and are benchmarked with a concurrent hierarchy writer (S9, O8); the predicates and hierarchy locking are not modified (S10, O9); load and penetration testing only with authorization, on disposable infrastructure with synthetic data (S7). Related: [audit](SECURITY_BASELINE_AUDIT.md) F-03, F-07, F-12; [edge ADR](../architecture/decisions/ADR-edge-origin-protection.md) (R6: edge limits are additional, not a replacement); [capabilities contract](CAPABILITIES_ENDPOINT_CONTRACT.md) section 13; [lock-contention investigation](PREDICATE_LOCK_CONTENTION_INVESTIGATION.md). No Redis is introduced (accepted data/state/cache ADR).

## 1. What exists today (verified in code, 19 Nov 2026)

| Control                           | Value                                                                                                   | Where                                       | Limit of the control                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| BFF anonymous budget, per client  | 30 per minute (login and device challenge only)                                                         | `packages/auth-bff/src/index.ts` (budgets)  | Needs a trusted client address (hop count); else the shared bucket below                             |
| BFF anonymous, unattributed       | 300 per minute, one shared bucket                                                                       | same                                        | One flood fills the shared bucket for everyone behind it                                             |
| BFF session reads / writes        | 240 and 60 per minute per session (a non-GET is a write)                                                | same                                        | Keyed by a hash of the session cookie; every other route shares these two budgets                    |
| Limiter                           | Fixed one-minute window, 10,000 keys, process-local                                                     | `packages/auth-bff/src/rate-limit.ts`       | Several instances multiply budgets; a restart resets them; fixed windows allow a burst at a boundary |
| BFF body cap                      | 16,384 bytes; 163,840 bytes for the geometry write (up to 5,000 vertices); URL at most 2,048 characters | BFF `defaultBodyLimit`, `geometryBodyLimit` | Header size is whatever the Node default allows; not set or tested here                              |
| BFF to API timeout                | 10 s                                                                                                    | BFF upstream fetch                          | One fixed value for every route                                                                      |
| API body, in-flight, timeouts     | 262,144 bytes; 256 requests in flight; request 30 s, headers 15 s, keep-alive 5 s                       | `apps/api/src/security/http-hardening.ts`   | In-flight cap is global, not per route class or per session; excess is shed                          |
| Database pool and statement limit | 2 connections per role pool; statement timeout 10 s                                                     | `apps/api/src/pilot/runtime.ts`             | A slow predicate holds a connection; lock waits are not separately limited (F-15)                    |
| Page size                         | At most 100 rows (default 25)                                                                           | `packages/validation` page schemas          | Bounds one response, not volume over time (F-07)                                                     |

Not present: a budget per route class, a per-session concurrency limit, a BFF in-flight cap, a route inventory with a test, header-size limits, and a record of how many rows a session reads over time.

## 2. Route inventory and proposed classes

Generated from the API controller decorators on 19 Nov 2026 (`apps/api/src/pilot/pilot.controller.ts`, `health`, `readiness`). The BFF serves a subset of these paths. **The classes are a proposal; nothing enforces them yet.**

| Class                       | Routes                                                                                                                                                                 | Why separate                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| C0 anonymous authentication | `POST auth/login`, `POST auth/device-challenge`                                                                                                                        | Public, abusable; interacts with D2/D3 (SEC-A5)                 |
| C1 session housekeeping     | `POST auth/csrf`, `POST auth/logout`, `POST auth/token` (API only)                                                                                                     | Cheap; must always work so a person can sign out                |
| C2 reference reads          | `registration/context`, `registration/geographies`, `land/geographies`, `farmers/correction-geographies`, `projects/organizations`                                     | Small, cacheable lists used by forms                            |
| C3 paged list reads         | `farmers`, `land`, `projects`, `enrollments`, `enrollment-policies`                                                                                                    | Up to 100 rows each; main bulk-extraction surface (T10, F-07)   |
| C4 detail and history reads | `farmers/detail`, `farmers/history`, `farmers/verification-receipt`, `farmers/correction-receipt`, `land/detail`, `projects/detail`, `enrollments/detail`              | One record; history can be long                                 |
| C5 spatial reads            | `land/viewport`, `GET land/geometry`                                                                                                                                   | Heaviest reads; geometry payloads and spatial queries           |
| C6 writes                   | `farmers/register`, `farmers/change`, `projects/register`, `projects/change`, `enrollments/enroll`, `enrollments/withdraw`, `enrollment-policies/set`, `land/register` | Take locks, write audit rows                                    |
| C7 geometry write           | `POST land/geometry`                                                                                                                                                   | Largest body (163,840 bytes), spatial validation                |
| C8 operational              | `health`, `ready`                                                                                                                                                      | Unauthenticated; must not be a cheap way to load the database   |
| C9 capabilities (proposed)  | `GET` capabilities endpoint (contract, not built)                                                                                                                      | Runs many authorization predicates per call; see section 5      |
| C10 offline sync (reserved) | none exists today                                                                                                                                                      | Reserved so a sync route cannot ship without a class and budget |

## 3. Budget structure (values deliberately not chosen)

Each class gets a row in one table kept in the repository. Columns, with today's value where one exists:

| Dimension              | Today                                      | To be decided                                                               |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| Budget key             | client address (C0) or session hash (rest) | Also per account for C0 (D3 option B, SEC-A5)                               |
| Rate and window        | the four numbers in section 1              | Per class, from the measurements in section 7. **No per-day limit (S4)**    |
| Burst handling         | fixed window                               | Whether to move to a sliding or token-bucket window (design choice, tested) |
| Concurrency            | API global 256 only                        | Per session and per class, and a BFF in-flight cap                          |
| Request size           | 16,384 and 163,840 bytes                   | Confirm per class; add header-size limit                                    |
| Response size and rows | 100 rows per page                          | Keep; measure rows returned per session (section 6)                         |
| Timeout                | BFF 10 s, API 30 s, statement 10 s         | Per class, shorter for C2 and C8, bounded for C5 and C7                     |
| Refusal                | 429 with the generic body                  | 429 versus 503, and a `Retry-After` hint without revealing budgets          |

**Principles.** Budgets protect availability for legitimate field staff first (slow mobile networks, shared NAT, offline retries after reconnecting). A refusal is generic, never reveals whether an account exists, and is recorded as a privacy-safe event (SEC-A2). A limit is never the only defence (SEC-AUDIT-01): authorization stays in PostgreSQL, and edge limits are additional (edge ADR R6, R7).

## 4. Concurrency and load shedding (design)

- Add a **per-session concurrency cap** in the BFF (a small number of simultaneous requests per session, fewer for C5 to C7) and a **BFF in-flight cap**, so a slow database cannot absorb every connection through one session. Excess requests are refused fast (503 with a generic body), never queued without bound.
- **Fairness:** a single session or client must not exhaust the pool for others; this is why the cap is per session as well as global.
- **Single-flight for the capabilities endpoint** per session (contract section 13): a second request while one is running either joins it or is refused.
- Keep the state **process-local** (no Redis). With several instances the effective budget is multiplied, which the table in section 1 must state next to every number; a shared counter needs a demonstrated need and an architecture review.
- The database pool stays at two connections per role until measurement says otherwise; **a bigger pool is not a defence** against slow predicates.

## 5. The capabilities endpoint (C9)

Provisional values stay as written in the contract: 200 candidates, 600 total evaluations, soft 1.5 s, hard 2 s, `lock_timeout` 250 ms. They are **benchmarked, not adopted** (S9). Protections to build with the endpoint, none now: its own class and budget; per-session single-flight; a total evaluation budget and hard deadline that return `unknown`, never a denial; and tests with a concurrent hierarchy writer, because each predicate takes a shared lock on the hierarchy table (F-15). The predicates and the locking are **not** modified here (S10).

## 6. Read volume (F-07, T10): measure first

Per owner direction S4 there is **no per-day limit** and no new cap on rows. Design of the measurement, with no identifier used as a metric label:

- Counters per class: requests, refusals, and rows returned in buckets (for example 1, 10, 25, 50, 100).
- A per-session rolling count of rows returned, kept in memory only for detection, never stored or logged with an identifier; the event carries only a hashed session key (SEC-A2 hash key requirement).
- Provisional alert recommendations are produced from the measured distribution, reviewed by the owner (SEC-A7); recipients are pending assignment (S5).

## 7. Measurement plan (authorized only; nothing run)

Disposable stack, synthetic data, no live service, written authorization before any run (S7). Scenarios: one client many sessions; many clients behind one address; slow clients; large pages and deep history; spatial reads; geometry writes at the size cap; a concurrent hierarchy writer during reads and during capability calls; pool saturation; limiter behaviour at a window boundary; refusal fairness (does one abusive session degrade others). Record p50, p95 and p99 latency, in-flight count, pool wait, lock wait, 429 and 503 rates and memory. **No result exists yet; no threshold may be set until it does.**

## 8. Verification to build later

1. A **route inventory test** that fails when a route (API decorator or BFF path) has no class, and when a class has no budget row (F-12).
2. Tests per class: budget exhaustion refuses the next request and not another session's; shared-address clients are not locked out by one client; refusals are generic and emit one privacy-safe event; body and URL caps; the concurrency cap sheds instead of queueing.
3. The limiter and concurrency state stay bounded (key limit, no unbounded queue).
4. Mutation checks on each guard (remove the class lookup, ignore the concurrency cap).

## 9. Decisions needed from the owner

1. The class list in section 2 (add, merge or split classes).
2. Whether a budget may differ for the shared-address pilot case, after measurement.
3. Refusal behaviour: 429 versus 503, and `Retry-After`.
4. Per-session concurrency as a policy, and whether the BFF or the edge owns it.
5. Who authorizes and runs the measurement (section 7).

## 10. Not done, not claimed

No threshold changed, no code written, no measurement run, no independent review, and no edge exists to test against. Hosting is undecided (OPS-04). Gate G1, production security acceptance, hosting topology validation, incident-response ownership and authorized adversarial testing remain open. Findings F-03, F-07 and F-12 stay open.
