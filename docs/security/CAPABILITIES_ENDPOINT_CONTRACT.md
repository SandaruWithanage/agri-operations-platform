# Capabilities endpoint — proposed contract (read-only), revision 2

Status: **PROPOSED. Not approved. Not Gate G1 approval. Not authorization to implement slices C1, C2 or C3.** Nothing in this document is implemented. No migration, grant, role, default permission, privileged IAM mutation or authorization code accompanies it. DEC-02 answers Q1 to Q12 remain **provisional** and are not confirmed or client-approved; this contract fixes no role names, risk classes or approver rules.

Revision history: revision 1 merged in PR #106 (19 Nov 2026). **Revision 2 (19 Nov 2026)** answers the owner's review of PR #106: the architectural direction is accepted for further design, the seven owner directions on O1 to O7 are applied, predicate-error handling is corrected, and a coverage argument for candidate enumeration and the protections for the endpoint itself are added. It extends the addendum at the end of [ADR 0022](../decisions/ADR-0022-dynamic-role-and-assignment-administration.md) and belongs to the SEC-04 security-hardening workstream ([audit](SECURITY_BASELINE_AUDIT.md), [threat model](THREAT_MODEL_AUTOMATED_THREATS.md)).

Gates, restated: **C1 and C2 stay behind independent Gate G1 review. C3 stays behind a reviewed and tested C2.** Until C3 ships, the existing sidebar and action buttons are unchanged (see section 8).

## 0. What changed in revision 2

| Owner direction                                                                                                                                                     | Where it is applied   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| O1: restricted, recoverable UI on service failure; do not show every administrative action; distinguish confirmed denial, incomplete evaluation and service failure | Sections 4.3, 8       |
| O2: provisional 60 s maximum lifetime; `expiresAt` is a hard cutoff and is not extended by client stale time                                                        | Sections 4.3, 9       |
| O3: `held` is an account-wide action-discovery hint only; scope choices and final mutations need independent server checks                                          | Section 4.4           |
| O4: 200 candidates and 2 s are provisional; benchmark them; add a bounded total request-evaluation budget                                                           | Sections 5.4, 5.5, 10 |
| O5: privacy-safe operational telemetry for capabilities reads and security events                                                                                   | Section 11            |
| O6: reuse the existing cross-tab invalidation, with regression tests                                                                                                | Section 9.3           |
| O7: field-app capabilities for online UI only, never offline authorization                                                                                          | Section 12            |
| Predicate errors must not silently become a definitive denial                                                                                                       | Section 5.3           |
| Prove candidate enumeration covers every valid scope, including inherited and organization-wide grants                                                              | Section 5.2           |
| Endpoint anti-bot protection, concurrency limits, request budgets and load-abuse tests in the SEC-04 workstream                                                     | Section 13            |

Two corrections to revision 1, found while doing this work:

- Revision 1 said the response's absence of a permission means "not held". That cannot distinguish a confirmed denial from an evaluation that did not finish. Revision 2 lists **every** permission with an explicit state (section 4.3).
- Revision 1 called the existing cross-tab mechanism one to "reuse" for logout. What exists today is a `BroadcastChannel("agri-offline-access")` that carries a vault **suspension** for the offline workspace (`packages/sync-client/src/vault-catalog.ts:97-100`, consumed at `apps/field-pwa/components/offline-workspace.tsx:324-338`) and a `storage` event for the language preference. There is no existing broadcast for online sign-out, and a search of the tests found none that names this channel. Section 9.3 states what that means.

## 1. Purpose and non-goals

**Purpose.** Tell the signed-in interface which kinds of action the signed-in account may attempt **somewhere**, so the sidebar and action buttons can follow the database.

**Non-goals (each is a rule):**

- It is **not an authorization decision.** PostgreSQL still decides every request through its existing predicates. A stale, missing or wrong answer can hide a control the person is entitled to, or show one they are not; it can never allow an action.
- It is **not a way to list data.** It returns no record, name, count, coordinate or other account's information.
- It is **not an offline permission** (section 12).
- It is **not an administration surface.** No grant, role or catalog mutation is part of it.

## 2. Source of truth: the existing predicates

Authority is computed by fixed `SECURITY DEFINER` functions that read the grant rows for the **signed transaction actor** and re-check time windows at call time. The exact conditions below were read from the migrations on 19 Nov 2026; the later `CREATE OR REPLACE` definitions are the ones that count.

| Predicate                                                                                                                                  | Necessary conditions for `true` (from the function bodies)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authz.allowed(geography, permission, source)` (farmer ABAC migration)                                                                     | An active geography; a `permission_grant` row for the actor, in that geography's organization, for the permission, **active and inside its time window**, whose `geography_id` is null or equals the geography, whose `unit_id` is null or is an **ancestor of the geography's unit**, and (when `source` is not null) whose `registration_source` equals `source`; then either `coverage = 'organization'`, or an active in-window `assignment` row of the actor in the same organization whose geography and unit also match. A hierarchy cycle returns false. |
| `authz.allowed_project_geography(project, geography, permission, source)` (project scope migration, redefined by the enrollment migration) | Only these permission and source pairs: `enrollment.read` with a null source; `enrollment.create` and `enrollment.withdraw` with source `administrator` or `field_officer`. A `project_permission_grant` row of the actor for that project and permission whose `registration_source` is **exactly** the source, active and in window, with geography and unit conditions as above, and a matching `project_assignment`.                                                                                                                                         |
| `operations.allowed_organization(organization, permission, source)` (enrollment policy migration)                                          | Only `project.create`, `project.update` and `enrollment.policy` with source `administrator`, and `project.read` with a null source. An **organization-coverage** grant of the actor with **no** geography and **no** unit, source equal exactly, active and in window.                                                                                                                                                                                                                                                                                           |

**Rule C1.** The capabilities function **calls these predicates**; it never re-implements them and never decides from grant rows alone. Grant rows are read only to choose which scopes to ask about (section 5.2). A later change to a predicate, including the role-binding materialization in ADR 0022, changes the answer with no change here.

**Rule C1b.** Each permission must be evaluated with **the same source argument the real endpoint uses**, because the predicates treat a null source and a named source differently. Verified call sites: `farmer.verify`, `farmer.correct` and `farmer.audit.read` are evaluated with a null source (`apps/api/src/farmer/registry-service.ts:78-80`); `farmer.create` with the session's source (`farm.registration_geographies(p_source)`). The remaining permissions' source arguments are **not asserted here**: they must be taken from their call sites during the C1/C2 review and pinned by the behavioural parity test (section 14, test 2), which compares `held` with whether the real action is allowed, not with the predicate alone.

## 3. Permission identity

Unchanged from revision 1, restated briefly. Today grants store the permission as free text and there is no permission table or id. The proposed identity is a stable `permission_id` in `iam.permission_catalog` (never reused), with a unique `code`, EN/SI labels, a **scope kind** (`geography`, `project`, `organization`), an **evaluation source rule** (null, or the session's source) and a risk class. A permission with no scope kind or no source rule is not evaluated and is reported `unknown`. `permissionId` is `null` until the catalog migration (C1, behind Gate G1) exists; the client accepts both and keys by id when present, else by `code`.

The code defect found in revision 1's preparation (`enrollment.policy.set` is an audit action name, the permission is `enrollment.policy`) is fixed in the UI registry, and the registry guard now requires every code to appear where the database evaluates a permission.

## 4. HTTP contract

### 4.1 API (NestJS), internal only

`GET /pilot/capabilities`, same trust model as `GET /pilot/registration/context`: BFF key, short-lived bearer token, source header. **No query string, body or path parameter.** Actor, session and device come only from the verified token and the signed database context. Strict response DTO.

### 4.2 BFF (same-origin Next.js route)

`capabilities` is added to the allow-list, `GET` only; existing origin, fetch-site, session-cookie and `no-store` rules apply. The BFF **re-validates the response** (shape, UUIDs, bounds, `accountId` and `deviceId` equal to the session's, `source` equal to its own) and answers a generic 503 otherwise. It has its **own route class and budget** (section 13).

### 4.3 Response shape (v2)

Every permission the application knows about is listed exactly once with an **explicit state**. Absence is never a denial.

```json
{
  "accountId": "00000000-0000-4000-8000-000000000001",
  "deviceId": "00000000-0000-4000-8000-000000000002",
  "source": "administrator",
  "evaluatedAt": 1763530000000,
  "expiresAt": 1763530060000,
  "digest": "<64 hex characters>",
  "evaluation": {
    "status": "incomplete",
    "reasons": ["budget"],
    "evaluated": 600,
    "budget": 600
  },
  "permissions": [
    {
      "permissionId": null,
      "code": "farmer.read",
      "scopeKind": "geography",
      "state": "held"
    },
    {
      "permissionId": null,
      "code": "farmer.verify",
      "scopeKind": "geography",
      "state": "not_held"
    },
    {
      "permissionId": null,
      "code": "enrollment.create",
      "scopeKind": "project",
      "state": "unknown"
    }
  ]
}
```

| Field                                       | Rule                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accountId`, `deviceId`, `source`           | Must equal the session identity and the BFF's configured source, else the whole response is rejected.                                                                                                              |
| `evaluatedAt`, `expiresAt`                  | Epoch ms, safe integers, `0 < expiresAt − evaluatedAt ≤ 60 000`. `expiresAt` is the earlier of the lifetime and the earliest expiry among the grants that produced a `held` answer. **Hard cutoff** (section 9.1). |
| `digest`                                    | SHA-256 of the canonical permission list; for change detection and tests; not a secret and not an authenticator.                                                                                                   |
| `evaluation.status`                         | `complete` if no permission is `unknown`, else `incomplete`.                                                                                                                                                       |
| `evaluation.reasons`                        | Zero or more of `budget`, `deadline`, `candidate-cap`, `error`. Fixed codes only; never free text.                                                                                                                 |
| `evaluation.evaluated`, `evaluation.budget` | Predicate evaluations used and the per-request total budget (section 5.5); `evaluated ≤ budget`.                                                                                                                   |
| `permissions`                               | At most 64 entries, no duplicates. The BFF checks the count of entries and that the three states add up.                                                                                                           |
| `state: held`                               | A predicate returned true for at least one candidate scope.                                                                                                                                                        |
| `state: not_held`                           | **Confirmed denial:** enumeration for that permission finished, every candidate evaluated, and every one returned false, with no error.                                                                            |
| `state: unknown`                            | **Incomplete evaluation:** the budget, deadline, candidate cap or an error stopped the evaluation before a `held` result. Never a denial.                                                                          |

**A known permission that is missing from a valid response is treated by the client as `unknown`**, not as denied.

**Three outcomes the interface must distinguish** (section 8 gives the screens):

| Outcome               | What the server did                                                                           | State name used in the interface |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------- |
| Confirmed denial      | Complete evaluation, permission `not_held`                                                    | `denied`                         |
| Incomplete evaluation | Valid response, permission `unknown` (or `evaluation.status = incomplete`)                    | `unconfirmed`                    |
| Service failure       | No valid response: network error, 5xx, invalid or tampered response, or **an expired answer** | `unavailable`                    |

A 401 is not one of these: it follows the normal sign-in path.

### 4.4 What `held` means (O3)

`held` is an **account-wide action-discovery hint only**. It says "somewhere in my scope this would be allowed" so the interface can decide whether to offer a way to start the action. The following are therefore rules, each with a test:

- **H1.** Authorized **scope choices** (which geography, project or organization a person may pick) come only from their existing scoped endpoints, each independently checked by the database. The capabilities response is never used to build or filter a scope selector.
- **H2.** A mutation is never enabled for a particular record on the strength of `held`. Record-level enablement uses the server's per-record `access` flags; the mutation itself is re-authorized by the database.
- **H3.** `held` never makes the interface skip a server call, a confirmation or an error path. A server denial after a `held` answer is shown as a denial and triggers an immediate re-fetch (section 9.2).
- **H4.** The response carries no scope identifiers, names, counts, grant ids, windows, roles or other accounts' data.

## 5. Database function (design only)

### 5.1 Shape

One read-only function, for example `iam.my_capabilities(p_source text)`: `SECURITY DEFINER`, `SET search_path = pg_catalog`, owned by a `NOLOGIN` IAM function owner, `REVOKE ALL … FROM PUBLIC`, `EXECUTE` only to the API runtime login. No writes, no temp tables, no dynamic SQL. The actor is `authz.actor()`; a null actor returns nothing. `p_source` is validated against the two allowed values.

### 5.2 Candidate enumeration and why it covers every valid scope

**Principle: enumeration need only be a superset; the predicate makes every decision.** A candidate set may contain scopes the predicate rejects, which costs time only. It must never omit a scope the predicate would accept. That makes completeness provable.

Let `A` be the actor, `P` the permission and `S` the evaluation source.

| Family                                           | Candidate set `E` (the sound, exhaustive form)                                                                                                               | Why it contains every scope the predicate can accept                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geography (`authz.allowed`)                      | Every **active** geography in every organization for which `A` has **at least one** `permission_grant` row for `P`, whatever that row's state                | The predicate can return true only if such a row exists in the geography's organization (condition 1 in section 2). Conditions on window, geography, unit ancestry, source and assignment can only **remove** candidates, never add them. |
| Project (`authz.allowed_project_geography`)      | Every pair (project, active geography in the project's organization) for every project for which `A` has at least one `project_permission_grant` row for `P` | The predicate requires such a project row and a geography in the project's own organization.                                                                                                                                              |
| Organization (`operations.allowed_organization`) | Every organization for which `A` has at least one `permission_grant` row for `P`                                                                             | The predicate requires an organization-coverage grant in that organization.                                                                                                                                                               |

This covers the cases the owner named:

- **Inherited grants.** A grant restricted to unit `U` applies to every geography whose unit has `U` among its ancestors. The sound form includes **all** geographies of the organization, so every descendant is a candidate; the predicate then applies the ancestry test, including its cycle rule. No hierarchy walk is needed in the enumeration.
- **Organization-wide grants.** A grant with no geography and no unit applies to every geography of its organization, so all of them are candidates.
- **Assignment-based (`assigned`) coverage.** The grant row puts the organization in the candidate set; the predicate then requires the matching assignment.

**Narrowing is an optimization, not part of the contract.** Starting from the sound form, an implementation may narrow candidates (for example to geographies under a grant's unit subtree, or skip grants outside their time window) **only if** an equivalence test proves the narrowed set yields the same `held` and `not_held` results as the sound form on a generated fixture set (section 14, test 3). Any narrowing that cannot be proven equal is not allowed.

**Independent oracle.** The completeness claim is also tested without trusting the enumeration: on fixtures, `held` is compared with calling the predicate on **every active geography (or project and geography pair, or organization) in the whole database**, with no use of grant rows to choose candidates (section 14, test 1). A scope the enumeration missed would be exposed there.

Cost of the sound form: non-holders who have stale grant rows scan their organizations' geographies; holders stop at the first true. The budgets in section 5.5 bound this, and the benchmark (section 10) decides whether narrowing is needed.

### 5.3 Predicate errors can never become a denial (correction)

Each candidate evaluation has **three** possible results: true, false, or error. Combined per permission:

1. **`held`:** any candidate returned true. Evaluation stops. An error in a candidate not yet reached is irrelevant.
2. **`not_held`:** the enumeration finished **and** every candidate returned false **and** no error occurred and no limit was hit. This is the only way to produce `not_held`.
3. **`unknown`:** anything else: an error, the per-permission cap, the total budget or the deadline stopped the evaluation before a true result.

Implementation requirements (each tested):

- An exception raised by a predicate or by enumeration for one permission is contained to that permission, which becomes `unknown` with reason `error`; the SQLSTATE **class** (never message text) is recorded in telemetry. This limits the blast radius of one faulty permission.
- The exceptions that mean the whole transaction can no longer be trusted, namely cancelation by the statement timeout and a lock-timeout failure, are **not** swallowed: the function aborts and the request becomes a **service failure (503)**. A predicate that returns null counts as an error, not as false.
- The function never returns a partially built list: either a complete response in which every known permission has a state, or a failure.

Revision 1 said a predicate error "counts as not held". That is withdrawn.

### 5.4 Lock behaviour (a risk found in the predicate source)

`authz.allowed` and `authz.allowed_project_geography` run `LOCK TABLE farm.organizational_unit IN SHARE MODE` on **every call**, and a table lock is held to the end of the transaction. `SHARE` conflicts with the `ROW EXCLUSIVE` lock that any insert, update or delete takes, so while a capabilities transaction runs, a hierarchy change must wait, and a waiting writer then makes new `SHARE` requests wait behind it. A slow or abused endpoint could therefore stall hierarchy administration and then every predicate call (a lock-queue pile-up). The existing reference queries have the same property; this endpoint adds call volume, so the contract requires:

- the function runs in its **own short transaction** with a small `lock_timeout` (provisional 250 ms) so it fails fast as a service failure instead of queuing behind a writer;
- the total deadline and evaluation budget in section 5.5;
- a benchmark with a concurrent hierarchy writer (section 10).

Changing the predicates to avoid the table lock would be an authorization-code change and is **out of scope** here; it is flagged for the Gate G1 reviewer.

### 5.5 Provisional limits and the total evaluation budget (O4)

All numbers are **provisional placeholders, not measurements**. They exist so the design can be reviewed and benchmarked.

| Limit                                                                | Provisional value                                | Effect when reached                                 |
| -------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Per-permission candidate cap                                         | 200 evaluations                                  | That permission `unknown` (reason `candidate-cap`)  |
| **Total evaluation budget per request**                              | 600 predicate evaluations across all permissions | Remaining permissions `unknown` (reason `budget`)   |
| Soft deadline (checked between evaluations with `clock_timestamp()`) | 1.5 s                                            | Remaining permissions `unknown` (reason `deadline`) |
| Hard statement timeout                                               | 2 s                                              | Abort, service failure                              |
| Lock timeout                                                         | 250 ms                                           | Abort, service failure                              |
| Permissions evaluated                                                | At most 64                                       | n/a                                                 |

**Deterministic order.** Permissions are evaluated in a fixed priority order: the read permissions that gate the sidebar pages first, then create and mutation permissions, then the rest. When the budget runs out, the least critical permissions are the ones left `unknown`, and the outcome is repeatable for the same data.

**Benchmark acceptance (section 10)** decides the real values. Until it is done and reviewed, the provisional values must not be described as measured or safe.

## 6. Authorization boundaries and isolation

| Boundary   | How it holds                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account    | Actor from the signed database context; no input names an account; the BFF rejects a response whose `accountId` differs from the session's.                                                             |
| Device     | The session behind the token is bound to an approved device; the response carries `deviceId` and the BFF rejects a mismatch.                                                                            |
| Session    | Short-lived token per request, held by the BFF; logout, expiry or revocation ends access.                                                                                                               |
| Source     | Fixed by the BFF configuration; the field BFF cannot obtain administrator-source answers. Administrator-only permissions are reported `not_held` there, because the predicate refuses the pair.         |
| Disclosure | Only permission codes or ids and states. The catalog is reference data, so listing `not_held` entries discloses nothing about records or other accounts. No scope identifiers, counts or grant details. |
| Abuse      | No parameters to probe with; fixed small response; dedicated budgets and concurrency limits (section 13).                                                                                               |
| Escalation | None: the endpoint grants nothing and its answer is never an input to any mutation.                                                                                                                     |
| Replay     | A copied response is useless: it expires in at most 60 s and every mutation is re-authorized by the database.                                                                                           |

## 7. Failure handling summary

| Situation                                 | Server                                                          | Client                           |
| ----------------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| No trusted actor                          | Empty result only for a valid session; otherwise the normal 401 | Sign-in path                     |
| One permission's evaluation errors        | That permission `unknown` (`error`)                             | `unconfirmed`                    |
| Budget, deadline or cap reached           | Affected permissions `unknown`                                  | `unconfirmed`                    |
| Statement or lock timeout, database error | Generic 503, nothing returned                                   | `unavailable`                    |
| Rate or concurrency limit                 | 429 or 503 with `Retry-After`                                   | `unavailable` with backoff       |
| Invalid, tampered or oversized response   | BFF returns generic 503                                         | `unavailable`                    |
| Answer past `expiresAt`                   | n/a                                                             | `unavailable` (reason `expired`) |

## 8. Front-end behaviour (applied in C3, after a reviewed and tested C2)

**Until C3 ships the interface is unchanged:** the sidebar filters pages by their declared read permission and hides "Planned" entries only when a permission list is provided, and `PermissionAction` shows an action as server-checked when no list exists. That interim mode ("unknown" in the current provider) exists only because no capabilities service exists; **C3 retires it**, and after C3 the absence of a valid answer means the restricted state below, never "show everything".

State model after C3 (replaces the current `Capabilities = Set | "unknown"`):

`{ status: "ready", held, unconfirmed, evaluatedAt, expiresAt } | { status: "unavailable", reason: "network" | "server" | "invalid" | "expired" | "rate-limited" }`

| Interface state                            | Sidebar page                                                                                                                    | Create, edit and other mutation actions                                          | Other behaviour                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowed` (held)                           | Listed                                                                                                                          | Offered, with record-level flags and server checks still applying                | Normal                                                                                                                                                                                                                                      |
| `denied` (confirmed `not_held`)            | **Not listed**                                                                                                                  | **Not offered**                                                                  | None                                                                                                                                                                                                                                        |
| `unconfirmed` (unknown)                    | Listed, marked "permission check incomplete"; opening it still works because every list read is itself filtered by the database | **Disabled** with a short reason and a **Retry** control; never silently enabled | Background re-check with backoff                                                                                                                                                                                                            |
| `unavailable` (service failure or expired) | **Restricted recovery view:** no record navigation                                                                              | **None offered**                                                                 | A clear, plain-language panel: "Permissions could not be checked", a **Retry now** button, automatic retry with jittered backoff, **Sign out**, and (field app) the encrypted offline workspace link, which does not depend on this service |

The restricted state is a conservative convenience: the database still protects every action, so it limits what the interface offers during an outage, it does not secure anything. It must never trap a person: Retry and Sign out are always present, and recovery restores the normal view without a reload. Copy needs UX review and Sinhala review.

## 9. Lifetime, cache and invalidation

### 9.1 Hard cutoff (O2)

- Maximum lifetime **60 s (provisional)**. `expiresAt` is a **hard cutoff**: at that instant the answer stops being usable and the interface enters `unavailable (expired)`.
- **Client stale time never extends it.** The query's `staleTime` must be at most the remaining lifetime; `gcTime` is 0.
- The client measures remaining time from the moment of receipt with a **monotonic clock** (`performance.now()`), as `expiresAt − evaluatedAt`, so a wrong device clock cannot extend or shorten it.
- A proactive refresh starts well before the cutoff (provisional: at two thirds of the lifetime, with jitter) so the normal case never reaches the restricted view. The refresh does not extend the old answer: if it has not completed by the cutoff, the interface is restricted until it does.

### 9.2 Invalidation triggers

Immediate invalidation on: login, logout, session check, device change; any 401 or 403 from a protected read or mutation; any mutation that returns a version conflict or denial (H3); the tab becoming hidden (the existing `clearSession` path); a cross-tab message (below). Query key `["protected","capabilities",{accountId,deviceId,revision}]`. Nothing is written to `localStorage`, `sessionStorage`, IndexedDB or Dexie, and the server sends `no-store` with no `ETag`.

### 9.3 Cross-tab invalidation (O6)

What exists: `BroadcastChannel("agri-offline-access")` posting `{ accountId, deviceId, state: "suspended" }` when an account or device is suspended; the offline workspace locks the vault for that account and device only (`offline-workspace.tsx:324-338`). The consumer checks `state === "suspended"` and ignores other values.

Reuse plan: use the **same channel, the same feature detection and the same account-and-device scoping**, adding new `state` values (for example `signed-out` and `capabilities-stale`). Because the existing consumer ignores unknown states, this is backward-compatible. The payload carries the two identifiers already carried today and no permission data.

Where `BroadcastChannel` is unavailable, the 60 s hard cutoff is the fallback.

**Regression tests, written before the channel is extended (first task of C3):**

1. The existing `suspended` message still locks the vault for the matching account and device (this behaviour has no test today).
2. A message for another account or device changes nothing.
3. A `capabilities-stale` or `signed-out` message for the matching account and device invalidates capabilities in every other tab.
4. The vault consumer ignores the new states.
5. No `BroadcastChannel`: the answer still expires at the cutoff.
6. The payload contains no permission data.
7. The language `storage` mechanism is untouched.

## 10. Benchmarks required before any limit is fixed (O4)

On a disposable stack with synthetic data only, with the real predicates:

| Case                                             | Shape                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Organization-wide holder                         | Early exit on the first geography                                                             |
| Narrow assigned holder in a large organization   | 10 000 geographies, deep unit hierarchy                                                       |
| Non-holder with many stale or expired grant rows | Worst case for the sound enumeration                                                          |
| Many permissions unevaluable within the budget   | Exercises `unknown` and the deterministic order                                               |
| Concurrency                                      | N concurrent sessions (N chosen from the capacity plan)                                       |
| **Concurrent hierarchy writer**                  | Confirms `lock_timeout` prevents a lock-queue pile-up and that other endpoints are unaffected |
| Retry storm                                      | All clients retrying after an outage                                                          |

Recorded for each: latency distribution, evaluations used, `unknown` rate by permission, lock wait, database CPU. Acceptance targets (provisional, to be set with the reviewer): the sidebar read permissions are never `unknown` for representative organizations; typical holder latency stays well under the soft deadline; hierarchy writes are delayed by no more than the lock timeout. Results are recorded as dated evidence, and synthetic benchmarks are **not** production proof.

## 11. Privacy-safe telemetry (O5)

Operational telemetry, not business audit. It uses the structured event emitter planned as SEC-A2 and its allow-listed fields.

| Event                                                                                                     | Fields (fixed allow-list)                                                                                                                                                                  | Never contains                                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `capabilities.read.completed`                                                                             | outcome (`complete` or `incomplete`), reason codes, evaluations used (bucketed), duration (bucketed), counts of held and unknown (bucketed), keyed hash of account and client, route class | Permission code lists per account, scope identifiers, names, tokens, cookies, raw addresses |
| `capabilities.read.failed`                                                                                | failure class, SQLSTATE **class** only, duration bucket, keyed hashes                                                                                                                      | Error messages, SQL text                                                                    |
| `capabilities.budget.exhausted`                                                                           | reason (`budget`, `deadline`, `candidate-cap`)                                                                                                                                             | As above                                                                                    |
| `capabilities.ratelimit.exceeded`                                                                         | route class, limiter that refused                                                                                                                                                          | As above                                                                                    |
| Security events from the endpoint (spoofed header, origin rejection, tampered response caught by the BFF) | Event name, reason code, keyed hashes                                                                                                                                                      | As above                                                                                    |

Provisional alert ideas (thresholds unmeasured and labelled provisional): sustained `incomplete` or failure rate; many reads per session; the same client across many sessions; budget exhaustion for a particular organization (a sign the budget is too small or an enumeration problem). No per-read audit-table write.

## 12. Field app: online UI only (O7)

- Capabilities may shape **online** screens in the field app only. They are **never** consulted to authorize, enable or disable offline work, never stored in the vault, Dexie, `localStorage`, `sessionStorage` or any cache, and never used by synchronization. The server revalidates synchronized work against current authority exactly as today.
- Offline, the capabilities query is simply unavailable; the offline workspace behaves exactly as it does today and does not depend on it.
- The service worker caches only static assets and the shell (`apps/field-pwa/public/sw.js:5-10`); the BFF route must stay outside that rule.
- Tests: an extension of `tests/service-worker.test.ts` proving `/api/pilot/capabilities` is never cached; a static guard that no offline module (`offline-workspace`, `packages/sync-client`) imports the capabilities client; a storage spy proving nothing is persisted; a test that the offline workspace and its sign-in link work with the capabilities service unreachable.

## 13. Endpoint protection (SEC-04 security-hardening workstream)

This endpoint turns a cheap request into expensive database work, so it is a **compute-amplification target** and is added to the SEC-04 workstream (audit slices SEC-A4 and SEC-A8, threat T22). Requirements before C2 can be accepted:

- **Route-class budget at the BFF**, separate from general reads: a small per-session and per-account request rate (provisional: a few per minute; normal use is about two per minute), with the existing process-local limiter treated as insufficient on its own (finding F-03).
- **Concurrency limit**: a small maximum number of concurrent capability evaluations per API process (provisional single digits), shedding excess with 503 and `Retry-After`, never queuing. **Single-flight per session**: concurrent duplicate requests from one session share one evaluation.
- **Total evaluation budget and deadline** (section 5.5) so one request cannot consume unbounded database work.
- **Fail closed on control failure**: if a limiter or budget control is unavailable, the endpoint refuses (503) rather than evaluating without limits.
- **Anti-bot layering, not a single defence:** no reliance on CAPTCHA, user-agent filtering, browser fingerprinting or IP bans alone; the endpoint is reachable only with a valid session, device and BFF key, so the anonymous-bot surface is the login path already covered by SEC-04; edge challenges, when added, are signals only.
- **Client behaviour:** jittered exponential backoff and a retry cap to prevent self-inflicted retry storms; no polling faster than the refresh schedule; no retry loop on a 429.
- **Load-abuse tests:** one session flooding; many sessions from one client; many sessions in one organization; concurrency with a hierarchy writer; budget-exhaustion path; retry storm after a simulated outage; limiter-unavailable path; header spoofing against the route.

Numbers are placeholders until the benchmark and the owner's budget decisions (open decision O8 below).

## 14. Tests required before acceptance

**Database (real predicates, synthetic fixtures)**

1. **Independent oracle:** `held` equals "the predicate is true for some scope" where the scopes are **every** active geography, project and geography pair, or organization in the database, chosen without using grant rows.
2. **Behavioural parity:** for each permission, `held` equals whether the real endpoint or mutation function allows the action for a fixture account, using the same source argument as the real call site.
3. **Enumeration equivalence:** any narrowed enumeration yields the same states as the sound form across generated fixtures covering inherited unit grants at several depths, organization-wide grants, geography-restricted grants, `assigned` coverage with matching and non-matching assignments, windows (expired, future, inactive), sources (null, matching, mismatching), multiple organizations, and a hierarchy cycle.
4. **Three-state correctness:** an injected predicate error produces `unknown`, never `not_held`; statement timeout and lock timeout produce a failure, never a partial list; a null predicate result counts as an error.
5. **Budget and ordering:** exhaustion leaves the lowest-priority permissions `unknown`, deterministically; `evaluated ≤ budget`; the soft deadline fires before the hard timeout.
6. **Isolation:** account B's data never appears in account A's answer; null or forged actor context gives nothing.
7. **Catalog drift:** a catalog permission without a scope kind or source rule is reported `unknown`, never evaluated.
8. **Privileges:** no write privilege anywhere, `EXECUTE` only to the API runtime login, a non-login owner, a fixed `search_path`.
9. **Lock behaviour:** with a concurrent hierarchy writer, the function fails within the lock timeout and does not create a pile-up.

**API and BFF**

10. Strict DTO; any query, body or caller-supplied actor, account or device is rejected.
11. Allow-list, `GET` only, origin and fetch-site checks, `no-store`, route-class budget, concurrency limit and single-flight.
12. **Tamper tests:** wrong `accountId`, `deviceId` or `source`, missing or duplicate permission entries, counts that do not add up, `evaluated > budget`, `expiresAt` beyond 60 s, bad UUID, extra fields, oversized body: all end in a generic 503.
13. The field BFF cannot obtain administrator-source answers.

**Client and UI**

14. **Hard cutoff:** with fake timers, the answer is usable until exactly `expiresAt` and unusable immediately after; a wrong wall clock changes nothing; a stale-time setting cannot extend it.
15. Query-key isolation; invalidation on every trigger in section 9.2; nothing persisted.
16. The three outcomes and their screens (section 8): `denied` hides, `unconfirmed` disables with Retry, `unavailable` shows the restricted recovery view with Retry and Sign out; recovery restores the normal view.
17. A missing known permission is treated as `unknown`.
18. **H1 to H4 guards:** a static guard that no scope selector reads capabilities; a test that a server denial after `held` re-fetches and shows the denial.
19. The cross-tab regression tests in section 9.3.
20. The field and offline tests in section 12.
21. Telemetry privacy: events contain only allow-listed fields, with a redaction test using planted secrets and permission lists.
22. Load-abuse tests in section 13.
23. Real-browser run: remove a synthetic grant, wait one lifetime, confirm the control disappears and a forced action is still refused by the server; stop the service and confirm the restricted view and recovery.

## 15. Delivery slices and gates

| Slice | Content                                                                                                                                        | Gate                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| C0    | This contract (revision 2), the ADR 0022 addendum, the audit and handover updates. Documentation only                                          | Owner review, retained as PROPOSED                                              |
| C1    | Permission catalog with ids, scope kinds and evaluation source rules (read-only)                                                               | **Independent Gate G1 review.** DEC-02 risk classes remain provisional          |
| C2    | `iam.my_capabilities`, API and BFF routes, endpoint protections (section 13), benchmarks (section 10), database, API, BFF and load-abuse tests | **Independent Gate G1 review.** Depends on SEC-A2 (events) and SEC-A4 (budgets) |
| C3    | Client query, provider, sidebar and action wiring, restricted recovery view, UI and browser tests                                              | **Only after C2 is reviewed and tested**                                        |

## 16. Open questions

O1 to O7 are answered by the owner's directions of 19 Nov 2026 (provisional, applied above). Remaining:

| #   | Question                                                              | Note                                                                     |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| O8  | Budget and rate numbers for the endpoint, and who receives the alerts | Provisional placeholders until the benchmark; owner and reviewer decide  |
| O9  | Should the predicates avoid the table-level lock (section 5.4)?       | An authorization-code change: for the Gate G1 reviewer, not decided here |
| O10 | Copy, layout and Sinhala wording of the restricted recovery view      | Needs UX and native-speaker review                                       |
| O11 | Whether any narrowing of the candidate enumeration is worth its risk  | Decide from benchmark and the equivalence tests                          |
| O12 | Who performs the independent review and when                          | Owner                                                                    |

## 17. What this document does not do

It creates no role, grant, default permission, migration or privileged IAM mutation, changes no authorization code, records no DEC-02 answer as confirmed or client-approved, and marks neither Gate G1 nor client approval complete. Severity and design judgements are the engineer's and carry no approval. Nothing here is claimed production-proven.
