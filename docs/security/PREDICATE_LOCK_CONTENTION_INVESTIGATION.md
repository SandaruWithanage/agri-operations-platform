# Authorization predicate lock contention: investigation and alternatives (owner direction O9)

Status: **investigation and design alternatives for independent security review. No predicate, migration, grant or lock behaviour is changed.** Written 19 Nov 2026. Owner direction O9: do not modify the existing authorization predicates or the hierarchy locking yet; investigate contention, document alternatives, and require independent security review before any change to authorization behaviour. This document does that and recommends nothing be changed until the benchmark and that review are done. Related: audit finding F-06 and F-15, [capabilities contract](CAPABILITIES_ENDPOINT_CONTRACT.md) section 5.4, [audit](SECURITY_BASELINE_AUDIT.md).

## 1. What the code does today (verified in the migrations)

Three predicate definitions run `LOCK TABLE farm.organizational_unit IN SHARE MODE` on **every call**:

| Location                                                    | Function                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `database/migrations/20261115_zzzz_farmer_abac/up.sql:90`   | `authz.allowed`                                                                 |
| `database/migrations/20261116_project_scope/up.sql:54`      | `authz.allowed_project_geography` (first definition)                            |
| `database/migrations/20261116_project_enrollment/up.sql:28` | `authz.allowed_project_geography` (later `CREATE OR REPLACE`, the one in force) |

The comment beside the first lock states the intent: "Serialize hierarchy changes while evaluating ancestry; optimize only with equivalent locking tests." The lock guarantees that the ancestry of a geography's unit cannot change between the moment the predicate reads it and the moment the calling transaction finishes. A table lock is held until the end of the transaction, so a transaction that calls a predicate holds `SHARE` on the whole hierarchy table until it commits.

Callers include every list and mutation that checks a geography, and `farm.registration_geographies`, which evaluates the predicate once per active geography inside one statement.

## 2. The hazard

In PostgreSQL, `SHARE` is compatible with other `SHARE` locks but conflicts with `ROW EXCLUSIVE`, which every insert, update and delete takes. Lock requests are granted in queue order: a new request that conflicts with a request already **waiting** is queued behind it, even if it would be compatible with the locks currently held. The consequence is a lock-queue pile-up: one long predicate-calling transaction, one hierarchy write, and then every later predicate caller waits.

## 3. Measured demonstration (disposable, synthetic, local)

To check the behaviour rather than assume it, a throwaway PostgreSQL 16.15 cluster was started on the engineer's sandbox with a synthetic 200-row table standing in for the hierarchy (no project schema, no project data, no real data). It was deleted afterwards. Session A held `SHARE` for 3 s; times below are seconds from the start of each run.

| Event                                     | Control: no writer       | With a hierarchy writer                                           |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| A takes `SHARE` and holds it              | 0 s                      | 0 s                                                               |
| B (hierarchy `UPDATE`) starts             | not run                  | 0.51 s                                                            |
| C (another `SHARE` caller) starts         | 1.02 s                   | 1.02 s                                                            |
| **C gets its lock**                       | **1.06 s (immediately)** | **3.05 s (about 2 s later, only after A commits and B finishes)** |
| B finishes                                | n/a                      | 3.05 s (waited for A)                                             |
| D (`SHARE`, `lock_timeout` 250 ms) starts | 1.22 s                   | 1.22 s                                                            |
| **D result**                              | **granted (1.26 s)**     | **`ERROR: canceling statement due to lock timeout` at 1.52 s**    |
| A commits                                 | 3.06 s                   | 3.05 s                                                            |

What this shows, and does not show:

- With no writer, other predicate callers are not delayed by A. With one waiting writer, **later callers are delayed until the first transaction finishes**, which confirms the queueing behaviour in section 2.
- A short `lock_timeout` turns that wait into a fast, clean failure (SQLSTATE class 55, lock not available), which is the service-failure path the contract specifies.
- It is **one run of each scenario** on a single local node with a synthetic table. It demonstrates PostgreSQL's lock-manager semantics; it is **not** a benchmark of the project's functions, not a measure of production behaviour, and not production proof.

## 4. Exposure today and what the proposed endpoint adds

- Today the hazard exists wherever a transaction holds a predicate-taken lock for long: a large `registration_geographies` call, or a slow mutation. The existing API pools use a 10 s `statement_timeout` but no `lock_timeout`.
- Hierarchy writes are rare administrative actions, which keeps the practical risk low today. A request that can be repeated cheaply by many sessions (the proposed capabilities endpoint) raises the chance that a writer arrives while predicate transactions are in flight, and the writer's wait then stalls readers. That is why the contract requires its own short transaction, a `lock_timeout`, a total evaluation budget, a concurrency limit and a benchmark with a concurrent writer.

## 5. Alternatives considered (none implemented)

Every alternative that changes authorization behaviour needs independent security review (owner direction O9, Gate G1) and, per the code comment, **equivalent locking tests** proving the serialization guarantee still holds.

| #   | Alternative                                                                                                                                                                                            | How it helps                                                      | Risks and open questions                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A0  | **Keep the lock; contain it operationally** (what the contract requires): own short transaction, `lock_timeout`, total evaluation budget and deadline, concurrency limit, single-flight, route budgets | No change to authorization behaviour; failure is fast and visible | Does not remove contention for the other callers; depends on measured numbers                                                                                                                                                     |
| A1  | Replace the table lock with **row-level `FOR SHARE` locks on the units in the ancestry chain** (the predicate already locks the geography and project rows this way)                                   | A writer to an unrelated unit no longer waits; far less queueing  | Must be proven that every hierarchy mutation that can change an evaluated ancestry conflicts with those row locks (parent changes, moves between units, activation changes); a new child unit does not change existing ancestries |
| A2  | **Per-organization advisory locks** (shared for predicate callers, exclusive for hierarchy writers in the fixed functions)                                                                             | Narrows the lock to one organization                              | Needs every writer to cooperate (a migration); lock-key design; advisory locks are easy to misuse                                                                                                                                 |
| A3  | **Snapshot evaluation** for read-only discovery (a separate evaluation path that reads the hierarchy from a consistent snapshot without the table lock)                                                | No lock at all for the discovery hint                             | Accepts a short stale-ancestry window; acceptable for a hint (the contract already treats `held` as a hint) but **not** for mutation authorization; needs a separate code path or parameter, which is an authorization change     |
| A4  | **Hierarchy version check:** read a version counter, evaluate without the lock, re-read the version, treat a change as `unknown`                                                                       | Lock-free reads; correctness preserved by retry or `unknown`      | A version column and writer cooperation (a migration); more moving parts                                                                                                                                                          |
| A5  | **Materialized ancestry** (closure table kept by triggers)                                                                                                                                             | Removes the recursive query and the need to lock for traversal    | Largest change; trigger correctness and migration risk                                                                                                                                                                            |

Not recommended now: any change to the existing predicates. The recommendation is **A0, then measure**.

## 6. Measurement plan (before any alternative is considered)

On a disposable stack with synthetic data and the real predicates, as set out in [contract section 10](CAPABILITIES_ENDPOINT_CONTRACT.md):

- shapes: organization-wide holder, narrow holder in a large organization (10 000 geographies, deep hierarchy), non-holder with many stale grants, many permissions exhausting the budget;
- concurrency: N concurrent predicate callers with **and without** a concurrent hierarchy writer; retry storm after an outage;
- record: latency distribution, lock wait time, number of queued sessions, writer wait, evaluations used, `lock_timeout` failures, database CPU;
- acceptance targets (provisional, to be set with the independent reviewer): hierarchy writes delayed by no more than the lock timeout; no pile-up of unrelated endpoints; sidebar read permissions never `unknown` for representative organizations.

## 7. Required before any authorization behaviour changes

1. Benchmark evidence from section 6, recorded as dated evidence.
2. A written alternative with a correctness argument and **equivalent locking tests** (the serialization guarantee demonstrated by tests, not argued).
3. **Independent review by a qualified AppSec and PostgreSQL reviewer** (owner direction O12; no reviewer is assigned yet).
4. A reviewed migration. Nothing here is approved, and Gate G1 is not complete.

## 8. What this document does not do

It changes no predicate, lock, migration, grant or role. It claims nothing is production-proven. The demonstration is a synthetic, single-node illustration of lock-manager behaviour.
