# Capabilities endpoint — proposed contract (read-only)

Status: **PROPOSED for owner and independent security review (Gate G1). Nothing in this document is implemented.** No migration, grant, role, default permission or authorization code accompanies it. DEC-02 answers stay provisional; this contract fixes no role names, no risk classes and no approver rules. It extends the addendum at the end of [ADR 0022](../decisions/ADR-0022-dynamic-role-and-assignment-administration.md) and is the step that lets the existing sidebar and action buttons (UI rule 3 in [UI_DEVELOPMENT_RULES.md](../development/UI_DEVELOPMENT_RULES.md)) become real.

Dated 19 Nov 2026. Everything below was written from the repository as it is today; where a statement depends on something that does not exist yet (a permission catalog with ids), it says so.

## 1. Purpose and non-goals

**Purpose.** Tell the signed-in interface which kinds of action the signed-in account may attempt **somewhere**, so the sidebar and action buttons can follow the database instead of showing everything.

**Non-goals (each is a rule, not a gap):**

- It is **not an authorization decision.** PostgreSQL still decides every request through its existing predicates. A stale, missing or wrong answer from this endpoint can hide a button the person is entitled to, or show one they are not; it can never allow an action.
- It is **not a way to list data.** It returns no record, name, count, coordinate or other account's information.
- It is **not an offline permission.** The field app must never keep it in the vault or use it to authorize offline work (ADR rule: a cached reference list is not an offline grant).
- It is **not an administration surface.** No grant, role or catalog mutation is part of it.

## 2. Source of truth: the existing predicates

Authority today is computed by fixed `SECURITY DEFINER` functions that read the grant rows for the **signed transaction actor** and re-check time windows at call time:

| Predicate (verified in the migrations)                                            | Scope it evaluates                                                                                                      | Used for                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `authz.allowed(p_geography, p_permission, p_source)`                              | One geography, with unit ancestry, validity window, optional registration source, `organization` or `assigned` coverage | Farmer and land permissions                       |
| `authz.allowed_project_geography(p_project, p_geography, p_permission, p_source)` | One project and one geography                                                                                           | Enrollment permissions                            |
| `operations.allowed_organization(p_org, p_permission, p_source)`                  | One organization; only organization-wide grants with no geography or unit; fixed permission and source pairs            | Project catalog and enrollment-policy permissions |

**Rule C1.** The capabilities function **calls these predicates**; it never re-implements them and never decides from grant rows alone. Grant rows are read only to choose _which scopes to ask about_ (the candidate set, section 5.3). Any later change to a predicate, including the role-binding materialization in ADR 0022, therefore changes the answer with no change here.

**Rule C2.** A predicate that errors, times out or returns null counts as "not held". If the function itself cannot complete, the whole request fails with a generic 503 and returns nothing (no partial list).

## 3. Permission identity

Today grants store the permission as free text (`authz.permission_grant.permission`, `authz.project_permission_grant.permission`) and the predicates compare strings. There is no permission table and no permission id.

The proposed identity (ADR 0022 addendum) is:

- `iam.permission_catalog` rows carry a stable `permission_id` (uuid, never reused, never reassigned to another meaning) beside a unique `code`, EN/SI labels, a **scope kind** (`geography`, `project`, `organization`) and a risk class. A permission with no scope kind is not evaluated (fail closed).
- The response is keyed by `permission_id`. `code` is informational and is what today's registry (`@agri/ui/permission-codes`) uses.

**Dependency (blocking):** `permissionId` cannot exist until the catalog migration (P1-03a in ADR 0022) is reviewed and applied. Until then the contract's `permissionId` field is `null` and the client keys by `code`. The client must accept both, and the tests pin both shapes, so the switch is a data change rather than a code change. This contract does not require granting or changing anything to ship that first step.

**Defect found while preparing this contract (fixed in the same PR):** the UI registry listed `enrollment.policy.set` as a permission. In the database that string is only an audit-journal action name; the permission the predicate checks is `enrollment.policy`. The registry now uses `enrollment.policy`, and the registry guard now requires every code to appear where the database evaluates a permission, not merely anywhere in a migration. Had the real list been switched on before this, the policy button would have been hidden from authorized administrators.

## 4. HTTP contract

### 4.1 API (NestJS), internal only

`GET /pilot/capabilities`

- Same trust model as `GET /pilot/registration/context`: the `x-agri-bff-key` header proves the caller is the BFF, `authorization: Bearer <short-lived access token>` identifies the session, `x-agri-source` carries the BFF's configured source (`administrator` or `field_officer`).
- **No query string, no body, no path parameter.** The actor, session and device come only from the verified token and the signed database context (`authz.actor()` HMAC). A request that carries any of them from the caller is rejected, so there is nothing to spoof.
- Strict response DTO; unknown fields are never added at runtime.

### 4.2 BFF (same-origin Next.js route)

- Path `capabilities` is added to the BFF allow-list for both apps; `GET` only.
- Existing BFF protections apply unchanged: `Origin`/`Sec-Fetch-Site` checks, per-session rate budget, HttpOnly session cookie, CSRF not required for GET, `Cache-Control: no-store`.
- The BFF **re-validates the response** the way it does for `registration/context`: shape, UUID formats, bounds, `accountId` and `deviceId` equal to the session's own, otherwise a generic 503. Nothing the API returns is forwarded unchecked.
- A source mismatch is impossible by construction (the BFF sends its own configured source); the field BFF can never ask for administrator-source answers.
- No `ETag` or conditional GET in v1 (see section 8 for why).

### 4.3 Response shape (v1)

```json
{
  "accountId": "00000000-0000-4000-8000-000000000001",
  "deviceId": "00000000-0000-4000-8000-000000000002",
  "source": "administrator",
  "evaluatedAt": 1763530000000,
  "expiresAt": 1763530060000,
  "digest": "<64 hex characters>",
  "permissions": [
    {
      "permissionId": null,
      "code": "farmer.verify",
      "scopeKind": "geography",
      "state": "held"
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

Field rules (all enforced by the BFF validator and by the client schema):

| Field                      | Rule                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accountId`, `deviceId`    | UUIDs; must equal the session identity, else the whole response is rejected.                                                                                                                                                       |
| `source`                   | `administrator` or `field_officer`; must equal the BFF's configured source.                                                                                                                                                        |
| `evaluatedAt`, `expiresAt` | Epoch milliseconds, safe integers, `expiresAt > evaluatedAt`, and `expiresAt − evaluatedAt ≤ 60 000`. `expiresAt` is the earlier of the TTL and the earliest expiry among the grants that produced a `held` answer.                |
| `digest`                   | SHA-256 of the canonical permissions list; lets the client and tests detect change without comparing arrays. Not a secret and not an authenticator.                                                                                |
| `permissions`              | At most 64 entries, no duplicates. **Only `held` and `unknown` entries are present; absence means not held.**                                                                                                                      |
| `state`                    | `held`: a predicate returned true for at least one candidate scope. `unknown`: the candidate scan hit its cap or time limit before a true result; the client must treat it as "server decides", never as held and never as denied. |
| `scopeKind`                | Which predicate family was asked. Informational; it lets the interface explain _why_ a button also needs a record-level answer.                                                                                                    |

**What `held` means and does not mean.** `held` says "somewhere in my scope this would be allowed". It says nothing about a particular record. Record-level answers keep coming from the server's existing per-record `access` flags (farmer detail: `correct`, `verify`, `viewAudit`; project detail: `edit`) and, in the end, from the mutation itself.

**What it deliberately does not return:** geography, unit, project or organization ids; names; counts; grant ids, windows or origins; role names; other accounts. Scope lists already have their own authorized endpoints (`registration/geographies`, `land/geographies`), which stay the source for "which areas".

## 5. Database function (design only)

### 5.1 Shape

One read-only function, for example `iam.my_capabilities(p_source text)`:

- `SECURITY DEFINER`, `SET search_path = pg_catalog`, owned by a `NOLOGIN` IAM function owner, `REVOKE ALL … FROM PUBLIC`, `EXECUTE` granted only to the API runtime login. Same pattern as `farm.registration_geographies`.
- No writes, no temp tables, no dynamic SQL, no advisory locks of its own. It inherits the shared `SHARE` lock the predicates already take on `farm.organizational_unit`, so the transaction stays short and runs under a statement timeout (proposed 2 s).
- The actor is `authz.actor()`. If it is null the function returns no rows (fail closed). The function accepts only `p_source`, validated against the two allowed values.

### 5.2 Which permissions it evaluates

Only permissions in the catalog that have a scope kind and are not retired. Retired or unclassified permissions are skipped. The set is bounded (64).

### 5.3 Candidate scopes (what to ask the predicate about)

For each catalog permission, the candidate scopes come from **the actor's own active, in-window grant rows for that permission** (and the matching assignment rows), never from other accounts:

- `geography` kind: active geographies in the organizations where the actor holds such a grant row, narrowed to the grant's geography or unit subtree when it has one; for each, `authz.allowed(geography, permission, source)`.
- `project` kind: the (project, geography) pairs named by the actor's project grant and assignment rows; for each, `authz.allowed_project_geography(...)`.
- `organization` kind: the organizations where the actor holds an organization-wide grant row; for each, `operations.allowed_organization(...)`.

Evaluation **stops at the first true** (`held`). A permission with no candidate rows costs no predicate calls, which is the common case for non-holders. A per-permission cap (proposed 200 candidates) and the statement timeout turn "scan not finished without a true" into `unknown`, never into `held`.

Because the candidate set is derived from the actor's own rows and every decision is made by the predicate, an account with no grants gets an empty list, and the work grows with what the account actually holds, not with the size of the organization.

### 5.4 Failure behaviour

| Situation                         | Result                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| No trusted actor context          | Empty list (API returns 200 with no permissions only if the session itself is valid; otherwise 401 from the normal token check). |
| Predicate error for one candidate | That candidate counts as not held.                                                                                               |
| Function error or timeout         | Generic 503, no body detail.                                                                                                     |
| Expired or revoked session        | The existing 401 from authentication; no capabilities.                                                                           |
| Device not the approved device    | The existing 401/403 from authentication.                                                                                        |

## 6. Authorization boundaries and isolation

| Boundary                   | How it holds                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account**                | The actor comes from the signed database context bound to the session. There is no input that names an account. The BFF rejects a response whose `accountId` differs from the session's. |
| **Device**                 | The session behind the token is bound to an approved device; the response carries `deviceId` and the BFF rejects a mismatch. A revoked device cannot obtain a token.                     |
| **Session**                | Short-lived token per request; the BFF holds it, the browser never does. Logout, expiry or revocation ends access immediately.                                                           |
| **Source**                 | Fixed by the BFF configuration; the field BFF cannot obtain administrator-source answers.                                                                                                |
| **Information disclosure** | Only permission codes or ids the account holds or may hold (`unknown`). No identifiers of scopes, no counts, no other accounts. Not-held and not-existing are the same absence.          |
| **Enumeration / abuse**    | No parameters to probe with; fixed small response; per-session rate budget; generic errors.                                                                                              |
| **Privilege escalation**   | None possible: the endpoint grants nothing and its answer is never an input to any mutation.                                                                                             |
| **Replay**                 | A copied response is useless: every mutation is re-authorized by the database; the response expires in at most 60 s.                                                                     |

## 7. Front-end consumption (after the contract is approved)

The existing implementation is kept; only its data source changes.

- **Provider.** `PermissionProvider` receives the result. To express `unknown` per permission, its value becomes `{ held: ReadonlySet<string>, unknown: ReadonlySet<string> }` (keys are `permissionId` when present, else `code`) or the existing `"unknown"` for "no answer yet". `permissionState` treats a key in `unknown` as `server-checked`, a key in `held` as `allowed`, and a key in neither as `denied`. The existing record-level rule stays: a record flag of `false` always wins.
- **Sidebar.** `AdminShell` already filters pages by the read permission each declares (`farmer.read`, `land.read`, `project.read`, `enrollment.read`) and hides the "Planned" list once permissions are known. No change to that component is needed.
- **Actions.** `PermissionAction` is unchanged; it already combines the account-wide answer with the server's per-record flag.
- **Request failure.** If the capabilities request fails (network, 503), the provider stays in `"unknown"`: pages and actions remain visible and the server decides, with a small status notice. Hiding everything because a convenience call failed would only lock people out of an interface the database still protects. A 401 follows the normal sign-in path. (Open question O1.)
- **Field app.** May use it to hide online-only actions in the signed-in home; must not store it, and must never use it to enable an offline action.

## 8. Cache and invalidation

**Server.** No server-side cache of per-account results in v1 (the answer must follow grant changes at the next evaluation). `Cache-Control: no-store` end to end. No `ETag` in v1: a conditional request would still require running the evaluation, and a 304 would add a path where a stale validator could hide a revocation.

**Client (TanStack Query, per the accepted data/state ADR; no persistent sensitive cache):**

- Query key: `["protected", "capabilities", { accountId, deviceId, revision }]`, the same pattern as the existing session query, so a different account, device or session can never read another's entry.
- `staleTime` 30 s and `gcTime` 0 (nothing kept after the last observer unmounts); never written to `localStorage`, `sessionStorage`, IndexedDB or Dexie.
- Refetch on window focus and reconnect; optional refetch at `expiresAt`. An entry past `expiresAt` is treated as `"unknown"`, not as the last answer.
- **Invalidate immediately** on: login, logout, session check, device change; any 401 or 403 from a protected read or mutation; any mutation that returns a version conflict or a denial; the tab becoming hidden (the existing `clearSession` path clears all protected queries); and, when they exist, successful IAM changes made in this session.
- **Multiple tabs:** logout in one tab clears the others through the existing broadcast mechanism (open question O6).
- **Offline:** nothing is read from or written to the vault. Going offline leaves the last answer in memory until it expires, then `"unknown"`.

**Revocation timing.** A removed or expired grant takes effect at the next evaluation. The interface can lag by at most the response TTL (60 s) plus the client stale time (30 s); during that window the database already refuses the action, and the screens already handle the refusal.

## 9. Tests required before this is accepted

**Database (against the real predicates, synthetic fixtures only)**

1. **Parity:** for a fixture set, `state = held` exactly when some candidate scope satisfies the predicate called directly; and no `held` where every predicate call is false.
2. Expired, inactive, not-yet-started, wrong-organization, narrower geography or unit grant, and wrong registration source each yield "not held".
3. An organization-coverage grant on a farmer permission yields `held` only via the predicate (no special-casing); a project or organization predicate that requires organization-wide-only grants is honoured.
4. Account B's fixtures never appear in account A's answer; null actor gives an empty result; a forged or unsigned actor setting gives an empty result.
5. Candidate-cap and timeout produce `unknown`, never `held`; a retired or unclassified catalog permission is skipped.
6. Catalog drift: a test fails if a catalog permission lacks a scope kind, or if the function would call a predicate the permission's scope kind does not allow.
7. Privilege tests: the function has no write privilege anywhere, `EXECUTE` only for the API runtime login, an owner that cannot log in, and a fixed `search_path`.

**API and BFF**

8. Strict DTO; any query string, body or caller-supplied actor, account or device is rejected; bearer and BFF key required.
9. BFF allow-list is `GET` only; origin and `Sec-Fetch-Site` checks; rate budget; `Cache-Control: no-store`.
10. **Response tamper tests:** wrong `accountId` or `deviceId`, wrong `source`, oversized list, duplicate entries, bad UUID, `expiresAt` beyond the bound, or extra fields all end in a generic 503.
11. The field BFF cannot obtain administrator-source answers.

**Client and UI**

12. Query-key isolation across account, device and session revisions; cleared on logout, hidden tab, 401/403; nothing persisted (storage spies).
13. `held`, `unknown` and absent each map to `allowed`, `server-checked` and `denied`; a record-level `false` still wins; an expired answer becomes `unknown`.
14. Sidebar and `PermissionAction` follow the three states (extends the existing shell and action tests); the existing guards (no raw consequential buttons, registered codes, shared components) stay.
15. **Stale answer never authorizes:** with the list saying `held` and the server answering 403, the screen shows the denial and re-fetches capabilities.
16. Real-browser run: remove a synthetic grant, wait one TTL, confirm the control disappears and a forced action is still refused by the server.

## 10. Delivery slices (each a small PR; none starts before its gate)

| Slice | Content                                                                                  | Gate                                                |
| ----- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| C0    | This contract, the ADR 0022 addendum update, the registry and guard fix                  | Owner review; independent security review (Gate G1) |
| C1    | Permission catalog with ids and scope kinds (P1-03a), read-only                          | G1; DEC-02 risk classes remain provisional          |
| C2    | `iam.my_capabilities`, API route, BFF route and validator, database/API/BFF tests        | G1                                                  |
| C3    | Client query, provider wiring, sidebar and action-level connection, UI and browser tests | After C2; owner confirms the contract is reviewed   |

C3 is deliberately last: nothing in the interface changes until the endpoint exists and has been reviewed. Until then the interface behaves as today (everything shown, the server decides).

## 11. Open questions for the owner and the reviewer

| #   | Question                                                                                                    | Recommendation                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| O1  | When the capabilities request fails, show everything (server decides) or hide everything?                   | Show, with a notice; the database protects every action.                                                     |
| O2  | Response TTL and client stale time (proposed 60 s and 30 s)?                                                | Keep short; revisit after measuring.                                                                         |
| O3  | Is "somewhere in my scope" (`held`) enough for create actions, or does a screen need the list of areas too? | Enough; areas come from the existing scoped endpoints.                                                       |
| O4  | Candidate cap and statement timeout values (200 and 2 s)?                                                   | Measure on realistic synthetic volumes before fixing.                                                        |
| O5  | Should a capabilities read be audited?                                                                      | No per-read audit (low risk, high volume); rely on rate limits and operational metrics. Reviewer to confirm. |
| O6  | Reuse the existing cross-tab broadcast for logout and invalidation?                                         | Yes.                                                                                                         |
| O7  | Do officers on the field app get it at all?                                                                 | Yes for hiding online-only actions; never stored, never used offline.                                        |

## 12. What this document does not do

It creates no role, grant or default permission, changes no authorization code, records no DEC-02 answer and marks neither Gate G1 nor client approval complete. Severity and design judgements are the engineer's and carry no approval.
