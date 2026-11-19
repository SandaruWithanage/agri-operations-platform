# Request budget measurement protocol and safe harness (SEC-A4)

**Status: PROTOCOL AND TOOL, PROPOSED. No measurement has been run.** This document and `scripts/measure-budgets.mjs` let the owner and a reviewer measure the **existing** request and resource behaviour of a **disposable local stack**. They change no limit and activate no threshold; results are inputs to a later, reviewed decision, never a decision. Nothing here is Gate G1 approval or production security acceptance, and nothing may be run against a live service (owner direction S7, 19 Nov 2026). Related: [budgets design](REQUEST_BUDGETS_DESIGN.md) section 7, [edge ADR](../architecture/decisions/ADR-edge-origin-protection.md) verification V5 and V7.

## 1. What the harness is, and is not

| It is                                                                                                                                 | It is not                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A small Node script that sends a bounded, fixed set of requests to a **loopback** address and records counts and timings              | A load-testing tool for any other host, a penetration tool, or something to run against staging or production                    |
| Read-only toward the stack's data except for the throttle counters that a failed sign-in attempt updates in a **disposable** database | A way to change, raise or lower any budget, concurrency cap, pool size or timeout                                                |
| Version 1 covers three unauthenticated scenarios (section 3)                                                                          | Complete: authenticated, spatial, geometry, slow-client, capability and hierarchy-writer scenarios are **not** built (section 6) |

## 2. Safety design (each guard is tested; fourteen mutations of them fail the suite)

- **Loopback only, plain http.** The target must be `localhost`, `127.0.0.1` or `[::1]` with no credentials, path, query or fragment. Lookalike hosts such as `127.0.0.1.example.test`, private ranges, `0.0.0.0` and https are refused. There is **no override**. Each connection's peer address is also checked after it opens; a non-loopback peer stops the run at once with nothing recorded.
- **Fixed paths and bodies.** The scenario names the route; the caller never supplies a path. Bodies are fixed synthetic values (invalid credentials, a filler body over the cap) with no real identifier.
- **Hard ceilings, not configurable:** at most 5,000 requests, 64 concurrent, 60 s, a 10 s per-request timeout; the oversize-body scenario at most 20 requests.
- **Dry run by default.** Without `--run` it prints the plan and opens no connection (tested against a counting server). A real run needs **all** of: `--run`, `--authorised`, `--ref <authorisation reference>`, the environment acknowledgement `MEASURE_DISPOSABLE_STACK=yes-this-is-a-disposable-stack`, and `NODE_ENV` other than production.
- **No sensitive output.** The report holds counts, status classes, error classes and latency percentiles. Response bodies are drained and discarded; no header, cookie, token or identifier is read or written (tested with a planted body and cookie).

## 3. Scenarios in version 1

| Scenario          | Route class | Fixed request                                                                               | What it observes                                                                                                                    |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ops-burst`       | C8          | `GET /health` (**API origin**)                                                              | Latency and refusals of the cheap unauthenticated route under a bounded burst                                                       |
| `anon-auth-burst` | C0          | `POST /api/pilot/auth/login` (**BFF origin**) with invalid synthetic credentials            | When the existing anonymous budget (30 per attributed client, 300 shared, per minute) starts refusing, and whether refusals are 429 |
| `oversize-body`   | C0 body cap | `POST /api/pilot/auth/login` (**BFF origin**) with a body just over the 16,384-byte BFF cap | That the cap refuses the request (expected 4xx) and the server stays healthy                                                        |

The expected values quoted above are today's **provisional** settings. A run **verifies the existing behaviour**; a difference is a finding to investigate, not a reason to edit a number.

## 4. Authorisation checklist (all before any run)

1. A written authorisation from the owner, with a short reference (for example a ticket id). The reference is recorded in the report.
2. The stack is **disposable**: a fresh local PostgreSQL created for this run and deleted afterwards, synthetic accounts only, no real farmer data, no credentials from any real system, no network route to a live service.
3. The API and BFF run locally against that database; the BFF hop count and origin settings are the ones under test and are recorded.
4. The operator, the date and the purpose are written down; a stop person is named.
5. Stop conditions agreed: any sign the target is not the disposable stack, any non-loopback peer, runaway errors, or resource exhaustion on the machine.

## 5. Running it

```bash
# 1. dry run (opens no connection): prints the plan and which gates are missing.
#    The target is the BFF origin for the two sign-in scenarios and the API origin for ops-burst.
node scripts/measure-budgets.mjs --target http://127.0.0.1:3000 --scenario anon-auth-burst --requests 100 --concurrency 4

# 2. real run, only after section 4 is complete
MEASURE_DISPOSABLE_STACK=yes-this-is-a-disposable-stack \
  node scripts/measure-budgets.mjs --target http://127.0.0.1:3000 --scenario anon-auth-burst \
  --requests 100 --concurrency 4 --run --authorised --ref OWNER-REF --out run-001.json
```

Repeat a scenario several times and keep each report; one run proves nothing. Reset the throttle state between runs by recreating the disposable database. Collect server-side resource figures **by hand on the disposable stack only** (process memory, connection pool waits, lock waits in `pg_locks`) and record them next to the report.

## 6. Not in version 1 (each needs its own reviewed addition)

Authenticated read and write classes with seeded synthetic sessions; spatial reads and the geometry write at the size cap; slow-body and slow-read clients; many clients behind one shared address; the capabilities endpoint (not built); a concurrent hierarchy writer during reads (the lock-contention case, F-15). They need seeded synthetic accounts and a reviewed scenario with a fixed path, and they keep the same guards.

## 7. Reporting and use of results

- Each report states the plan, the gates satisfied, the stack and settings under test, the counts and percentiles, the server-side figures taken by hand, and the **spread across repeats**.
- Results are **not** a benchmark, **not** production evidence and **not** a basis for any threshold on their own. A threshold needs the owner's decision after review, on measurements from a representative disposable stack, with the concurrent-writer and shared-address cases included.
- Reports contain no identifier and no secret, and stay outside the repository until reviewed.

## 8. Not done, not claimed

No scenario has been run against any stack; no threshold or resource policy was changed; the harness has not been independently reviewed; the stack under test has no edge, so edge limits (V5, V7) are not measured. Hosting (OPS-04), Gate G1, production security acceptance, real-device testing and client approval remain open.
