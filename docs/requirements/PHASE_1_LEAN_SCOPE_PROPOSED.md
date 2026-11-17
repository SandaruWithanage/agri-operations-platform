# Phase 1 lean scope — PROPOSED (not client-approved)

> **Superseded as a scope proposal (17 Nov 2026)** by [PHASE_1_STAFF_SCOPE_PROPOSED.md](PHASE_1_STAFF_SCOPE_PROPOSED.md). Kept as history; its fee, duration and exclusions are no longer the working proposal and none of them was ever approved.

**Status: proposal only. No client or owner approval is recorded here.** This additive document summarizes the lean P1 scope from [PHASE_1_AGENT_DEVELOPMENT_PLAN.md](../development/PHASE_1_AGENT_DEVELOPMENT_PLAN.md) (budget proposal v0.3: 18–20 weeks calendar, 160 engineering hours, LKR 250,000, all proposed). It does **not** replace, withdraw or edit the comprehensive SRS or the 71-decision register, which remain the proposed long-term requirements. Until a dated change order is signed, build and test only already-authorized bounded technical work with synthetic data.

## Proposed in-scope outcomes

| ID     | Outcome                                                                                                                                                                         | Planned work package |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| P1-F01 | Staff authentication, scoped authorization and controlled access (hardening and negative tests of existing hybrid sessions, MFA, approved device, BFF CSRF, PostgreSQL scopes). | WP02                 |
| P1-F02 | Minimal bilingual farmer registration (English or Sinhala name, configured geography, notice confirmation; duplicates flagged, never merged).                                   | WP03                 |
| P1-F03 | Encrypted offline farmer workspace in the existing vault (drafts, queued intents, retry, conflict/rejected states, server reauthorization).                                     | WP03                 |
| P1-F04 | Online reported land point only (explicit GPS action or manual WGS84, optional accuracy and reported area; scoped list/detail). Not a boundary, survey or title.                | WP04                 |
| P1-F05 | Synthetic-data staging with TLS, private database, migration discipline and a backup/restore rehearsal.                                                                         | WP05                 |
| P1-F06 | Testing, bilingual operator guides, UAT and handover.                                                                                                                           | WP06                 |

## Proposed exclusions (not promised in P1)

Project enrollment workflows and **offline enrollment** (ADR 0021 is not Accepted), farmer–land legal relationships, stock/resources, bulk import, broader staff administration, interactive parcel/polygon GIS and offline maps, expanded or custom reporting, secure lost-passphrase recovery/key escrow, a seven-day offline window, finance/procurement/harvest/transport/insurance, farmer self-service, vendor map integrations and multi-tenant SaaS. A feature from the full SRS enters P1 only through a dated change request with added hours, cost, dependencies, security work and owner/client approval.

Enrollment, policy administration, admin enrollment screens and Officer A/B enrollment isolation tests are already merged (PRJ-03A–D, PRJ-04B/C). They are **preserved** but are not P1 acceptance promises and are not enabled for real officers.

## Conflicts with the comprehensive scope (to be resolved by decision, not by editing)

- **Comprehensive reporting** (the plan cites Decision 29) and **full GIS** (Decision 48): the lean P1 defers both. Those two decisions are referenced from the plan only; the external 71-decision register was not available in the repository when this was written, so the wording must be checked against that register before any approval.
- **Seven-day offline configuration:** not enabled; documented as a gap needing a reviewed design and real-device tests.
- **Unresolved source-plan total** (2,700 versus 2,760 in the planning source, DEC-10): not imported or corrected.

## Approval record (intentionally blank)

| Item                                       | Record                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Client legal entity / authorized signatory | _not recorded_                                                                           |
| Project owner / delivery signatory         | _not recorded_                                                                           |
| Approved P1 scope reference and version    | _not recorded_                                                                           |
| Fee and calendar window                    | LKR 250,000 and 18–20 weeks are **proposed**                                             |
| G0 (P1 scope approval) date                | _not recorded_                                                                           |
| Real-data pilot (G3)                       | **Not authorized.** Requires separate privacy, device and independent security approval. |

## Client inputs still needed

Authorized approver; organization naming and branding (DEC-01); named pilot officers and scopes; test devices, OS and browser versions (DEC-07); the approved bilingual privacy notice (DEC-06); hosting destination and operating owner (DEC-08); support contacts; sample synthetic geographies; fluent Sinhala reviewers (DEC-11).
