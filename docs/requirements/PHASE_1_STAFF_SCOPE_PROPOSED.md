# Phase 1 staff platform scope — PROPOSED (not client-approved)

**Status: owner-proposed development direction. No client or contractual approval is recorded here.** This additive file records the project owner's 17 Nov 2026 scope reset described in [PHASE_1_COMPLETE_ADMIN_FIELD_AGENT_GUIDE.md](../development/PHASE_1_COMPLETE_ADMIN_FIELD_AGENT_GUIDE.md) (guide AOP-P1-STAFF-AGENT-001). It supersedes the earlier [lean Phase 1 proposal](PHASE_1_LEAN_SCOPE_PROPOSED.md) **as a scope proposal only**; the lean files remain as historical audit evidence. All business rules stay **provisional** (the 71 owner decisions, Appendix A of the guide) until a signed client baseline exists. Nothing here authorizes real farmer data, production use or any security gate bypass.

## Two phases

| Phase | Content                                                                                                                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | All internal staff-facing capability: admin web and field PWA, dynamic RBAC+ABAC, organization/geography/CBO administration, farmers, land and farmer–land relationships, full GIS with walk-the-boundary capture, project cycles and enrollment, resources/stock ledger, offline operations, reports/exports, imports/documents, operations and release readiness. |
| **2** | Farmer-facing logins and self-service (farmer portal, notices, own-record visibility). **Not part of this work and not to leak into Phase 1** through an incidental public endpoint. Farmers remain business records, not accounts, in Phase 1.                                                                                                                     |

## Included Phase 1 epics (all proposed)

`P1-ORG` organization, staff accounts and dynamic access · `P1-FARM` farmer records, verification, corrections and privacy · `P1-GEO` geography, coverage, contacts and assignments · `P1-LAND` parcels, relationships and evidence · `P1-GIS` maps, polygons and walk-the-perimeter survey · `P1-PRJ` projects, cycles and enrollment lifecycle · `P1-INV` resources and stock accounting · `P1-OFF` unified encrypted offline operations · `P1-RPT` dashboards, exports and scheduled reports · `P1-DATA` imports, documents, notifications and privacy · `P1-OPS` release, hosting, observability and handover. Delivery sequencing is in [PHASE_1_STAFF_EXECUTION_BOARD.md](../development/PHASE_1_STAFF_EXECUTION_BOARD.md).

## Excluded or not automatically authorized

- **Phase 2:** farmer accounts, self-service, farmer-initiated requests, farmer inbox/statements. Staff-recorded farmer acknowledgement is not a farmer login.
- **Not authorized by this proposal:** procurement/harvest purchase and transport, loan disbursement and settlement, insurance claims, legal cadastral survey certification, biometrics, satellite predictions, public multi-client SaaS and arbitrary third-party integrations. Staff-triggered outbound notifications only, and only after recipient/privacy/provider approval.
- **Real data:** no real farmer, GPS, stock or identity data until Gate G4 below.

## Hard gates (the agent may build behind them, never bypass them)

| Gate | Needed before                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0   | Treating this scope as a contractual baseline: signed client scope, estimate and change control (Q56, Q57, Q71). Until then labelled proposal/prototype work with synthetic data. |
| G1   | Changes to cryptography, vault recovery, RLS/privileged grants or sensitive exports: independent security review and recorded findings.                                           |
| G2   | Implementing offline enrollment (OFF-04A–D): ADR 0021 steps A1–A4. ADR 0021 is **NOT Accepted**.                                                                                  |
| G3   | Enabling offline enrollment for real officers: G2 plus implementation review, real devices, audited grants and a separate Gate E owner enablement record.                         |
| G4   | Any real client data: privacy/contract permission, tested security, approved device/location handling, staging proof and a named owner.                                           |
| G5   | Official-area or verified land status: agreed tolerances, verification authority and official datasets.                                                                           |
| G6   | Production launch: UAT, independent security and access review, tested backup/restore/rollback, real-device tests, signed approvals and operating owners.                         |

## Approval record (intentionally blank)

| Item                                       | Record                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Client legal entity / authorized signatory | _not recorded_                                                                       |
| Signed Phase 1 staff SRS/baseline version  | _not recorded_ (SRS v0.9 and architecture v0.9 are not in the repository)            |
| Scope, estimate and schedule               | _not recorded_; any earlier fee/duration is superseded as a proposal and unconfirmed |
| G0 date and approver                       | _not recorded_                                                                       |
| Real-data pilot                            | **Not authorized**                                                                   |

## Known unknowns that block specific work

Legal managing entity and branding (DEC-01); the client's actual role/permission matrix and approvers (DEC-02); land relationship and evidence definitions (DEC-03); enrollment/cycle policy (DEC-04); resource/unit/quota rules (DEC-05); retention, consent and notice wording (DEC-06); approved devices and offline security evidence (DEC-07); hosting provider, region, key custody (DEC-08); map and tile licensing and official boundary datasets (DEC-09); the 2,700 versus 2,760 planning-source discrepancy (DEC-10, not to be guessed); fluent reviewers and UAT approvers (DEC-11); field-officer enrollment authority (DEC-12).
