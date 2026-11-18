# ADR 0026 — Resource catalog, units and append-only stock ledger (PROPOSED design, not implemented)

Status: **design proposal for owner and independent security review (Gate G1). No code, migration, permission or grant accompanies it.** It covers P1-18 (SRS v0.9 FR-INV-001, FR-INV-002, FR-INV-006, FR-INV-007, FR-INV-013, FR-INV-015 in part and NFR-PERF-04; owner decisions Q21 and Q25). DEC-05 (resource, unit and quota rules) is open, the owner decisions are provisional and not client-approved, so every number and list below is a placeholder held as **data**, not code.

## Context

- No inventory schema exists. Q21 asks for a configurable resource catalog and an authoritative, auditable stock ledger and says to defer advanced warehouse and procurement features unless approved. Financial settlement, procurement and transport are not Phase 1 features (AGENTS.md).
- Q25 asks for resource-specific base units, stored submitted and normalized quantities, whole plants versus decimal mass, and versioned conversions. Q24 asks for loss, damage, returns and corrections as separate audited transactions.
- The system already has one mutation shape: fixed `SECURITY DEFINER` functions owned by restricted `NOLOGIN` roles, signed per-transaction actor context, HMAC idempotency journals, atomic audit rows, optimistic versions and `FORCE ROW LEVEL SECURITY` (see [CROSS_DOMAIN_INVARIANTS.md](../architecture/CROSS_DOMAIN_INVARIANTS.md), I5 to I10). Stock must follow it, not invent a second one.

## Scope of this ADR

| Task  | In this ADR                                                                                                                       | Not decided here                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P1-18 | Resource catalog, units and versioned conversions, locations, optional lots, the append-only ledger, and one first event: receipt | —                                                                                         |
| P1-19 | A design outline for transfers, returns and adjustments so the ledger shape fits them                                             | The detailed state machine and approver rules (own ADR after review)                      |
| P1-20 | Nothing                                                                                                                           | Quotas, allocations and farmer distribution need DEC-04 cycles, verified area and overlap |
| P1-21 | Nothing                                                                                                                           | Offline issuance needs ADR 0021 accepted and an independent review; no offline stock path |

The invariants plan lists the whole resource domain behind cycles, verified area and overlap. That holds for **quotas and allocations**; the catalog, units, locations and ledger core depend only on enrollment authorization that already exists, which is why P1-18 can be designed now.

## Decision (proposed)

### 1. Exact quantities, never floating point

All quantities are PostgreSQL `numeric` with an explicit scale limit, never `float`. Across the API and the BFF they travel as **decimal strings** validated by a strict pattern and length cap; no JavaScript `number` ever holds a quantity. Each resource's base unit carries a `decimal_places` value (zero for whole plants, for example three for kilograms). A normalized quantity that would need more places than the base unit allows is **rejected**, never silently rounded. Placeholders: at most 18 significant digits and scale 6 until DEC-05 sets them.

### 2. Catalog (additive, `inventory` schema, one new migration)

| Table                       | Purpose and constraints                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory.unit`            | Code, bilingual name, kind (count, mass, volume). Organization-scoped, unique per organization.                                                                                                                   |
| `inventory.resource`        | Bilingual name, category, `base_unit_id`, `lot_tracking` (default off), active, optimistic version. No crop type is hardcoded; categories and applicability are data (FR-INV-001).                                |
| `inventory.unit_conversion` | `(resource, from_unit)` with an exact `factor`, `effective_from`, version. **Append-only and versioned**: a new row supersedes, an old row is never edited, so history explains every past quantity (FR-INV-006). |
| `inventory.location`        | Warehouse or store, bilingual name, a binding to a geography unit so the **existing scope predicates** apply, active. Project-bound stock is an open question (Q1).                                               |
| `inventory.lot`             | Optional: source, batch code, received and expiry dates; unique per resource, source and batch code (FR-INV-009 groundwork). Created only for resources with `lot_tracking`.                                      |

Composite foreign keys carry `organization_id` everywhere, as in the existing schema, so no row can point across organizations. Catalog changes use fixed functions with an expected version, journal and audit; a deactivated resource keeps its history.

### 3. The ledger

`inventory.ledger_entry` is **append-only** (FR-INV-002):

- `id`, `organization_id`, `resource_id`, `lot_id` (nullable), `location_id`, `event_type` (`receipt` first; `issue`, `transfer_out`, `transfer_in`, `return`, `loss`, `damage`, `correction`, `adjustment` reserved for P1-19 and P1-20);
- `base_delta` (exact, signed, never zero) and the **as-entered** `entered_quantity`, `entered_unit_id` and the exact `conversion_id` version used, so the original submission and its normalization are both preserved (FR-INV-007);
- `reason` (required for every event type that is not a plain receipt), `reverses_entry_id` (nullable, **unique**: an entry can be reversed once, and a correction is a new compensating entry linked to the original, never an edit, FR-INV-013);
- `actor_account_id`, `occurred_at` (event time, as supplied) and `recorded_at` (server time), kept separately.

Append-only is enforced three ways: no runtime role holds `UPDATE` or `DELETE`; a trigger raises on any attempt; and `FORCE ROW LEVEL SECURITY` applies. Each is covered by a test that tries to defeat it and a mutation check that removes it.

### 4. Balances and concurrency (NFR-PERF-04)

Stock must never oversubscribe under concurrent writers. Proposed: a derived table `inventory.stock_position` (resource, lot, location) holds `on_hand_base` with `CHECK (on_hand_base >= 0)`. It is written **only** by the same fixed function, in the same transaction as the ledger insert, after taking the row lock (`SELECT … FOR UPDATE`, or an `UPDATE` guarded by the check). Two writers on one position therefore serialize and the second is refused cleanly rather than overdrawing.

The ledger remains authoritative: a reconciliation function recomputes the sum of `base_delta` for each position and must equal `on_hand_base`; a test proves it after randomized concurrent operations. If the reviewer prefers no stored balance, the alternative is a sum over the ledger under an advisory lock per position, at a cost in read performance. See Q4.

### 5. Authorization and privacy

- New permission codes (for example `inventory.read`, `inventory.catalog.manage`, `inventory.receive`) are added to the **existing** permission catalog as data. This ADR does not depend on the proposed IAM administration (ADR 0022). Nothing is granted to any real account: only synthetic grants exist in tests, because DEC-02 is unresolved.
- Default deny. A reader sees balances only for locations inside their assigned scope (FR-INV-015); no table has a runtime `SELECT` policy that returns another scope's rows; farmer and lot-to-farmer detail will need a separate purpose-based permission when P1-20 arrives.
- The record function authorizes first, validates, writes the ledger row and the position, journals and audits in one transaction, like every other mutation. A retry with the same mutation id and the same HMAC returns the original result; the same id with a different payload is a conflict, never a second movement.

### 6. Provisional policy held as data

Which event types need a reason, which need a second approver, the precision limits, and whether a resource tracks lots are rows in policy data with versions, so DEC-05 can change them without a migration of the ledger. Until DEC-05 is answered, synthetic seed data only is used and nothing here is described as approved.

## Threats and mitigations

| Threat                                            | Mitigation (proposed)                                                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Two issues drain the same stock at once           | Position row lock plus `CHECK (on_hand_base >= 0)`; the second writer is refused. Concurrency test with many writers. |
| Silent rounding or float drift changes quantities | Exact `numeric`, decimal strings end to end, scale check against the base unit; reject instead of round.              |
| Someone edits or deletes a past movement          | No runtime `UPDATE` or `DELETE`, a blocking trigger, FORCE RLS; corrections are linked compensating entries.          |
| One entry reversed twice                          | `reverses_entry_id` is unique.                                                                                        |
| A conversion changes and rewrites history         | Conversions are versioned and append-only; each entry stores the version used and the as-entered values.              |
| Retried request records stock twice               | HMAC idempotency journal; same id and payload returns the original result, different payload is a conflict.           |
| Officer reads another area's stock                | Location bound to a geography scope, existing scope predicates, FORCE RLS; Officer A/B tests.                         |
| Cross-organization reference                      | Composite foreign keys carry `organization_id` on every table.                                                        |
| Oversized or malformed quantities                 | Pattern and length cap at the BFF and API, digit limits in the database, bounded request size already enforced.       |
| Stored balance drifts from the ledger             | Reconciliation function and test after randomized concurrent runs; any difference is a defect, not a tolerated gap.   |

## Questions for the owner and reviewers

1. **Q1 (owner):** is a location bound to a **geography** unit (proposed, reuses current scope rules), to a **project**, or both?
2. **Q2 (owner):** which resources and units come first? Synthetic examples only (a count unit and a mass unit) are used until you name real ones.
3. **Q3 (owner):** which event types need a **second approver** (loss, damage, correction, return) and who may approve? This waits on DEC-02 for real roles.
4. **Q4 (reviewer):** stored `stock_position` with a check constraint (proposed) or a ledger sum under an advisory lock?
5. **Q5 (owner and reviewer):** precision and scale limits per unit kind, and whether negative stock is **never** allowed (proposed: never).
6. **Q6 (owner):** is lot tracking off by default and enabled per resource (proposed)?
7. **Q7 (owner):** is stock owned by the organization and location, or also by a project, so that one project's allocation cannot consume another's?

## Required tests before code is accepted

- Exact numerics: whole-count and decimal-mass units; a quantity needing more places than the base unit is rejected; strings only at the API boundary; no float in any path.
- Concurrency: many parallel receipts and issues on one position never overdraw and always reconcile to the ledger sum.
- Append-only: each runtime role fails `UPDATE`, `DELETE` and `TRUNCATE`; the trigger blocks the owner path; mutation checks remove each defence in turn and the test must fail.
- Idempotency: replay with the same id and payload returns the original; same id with a different payload is a conflict; one movement only.
- Reversal: a second reversal of the same entry is refused; the compensating entry links to the original and carries a reason.
- Conversions: a new version does not change the normalized value of earlier entries.
- Isolation: Officer A and B in different scopes and two organizations; no cross-scope read, no cross-organization reference.
- Failure states: unauthorized, inactive resource or location, wrong unit for the resource, missing reason.
- No offline path and no new grant to any real account.

## Not decided here

Quotas, allocations, farmer distribution and acknowledgement (P1-20), offline issuance (P1-21, ADR 0021), the transfer state machine and approver rules (P1-19), reports and exports, and any procurement or settlement. This ADR is **not accepted**; it records a design for review. The independent review (Gate G1) and the owner's answers to Q1, Q3, Q5 and Q7 must precede code.
