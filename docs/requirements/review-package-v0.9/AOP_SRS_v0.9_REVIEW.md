# SOFTWARE REQUIREMENTS SPECIFICATION (SRS)

## Agricultural Operations Management Platform — Proposed Comprehensive First Release

**Document ID:** AOP-SRS-001  
**Version:** 0.9 — Owner-proposed baseline for review  
**Prepared:** 16 November 2026  
**Approval:** **NOT CLIENT APPROVED**  
**Source:** 71 provisional owner Q&A decisions, 14 November master package baseline, checked GitHub `main` decision/status documents and reconciliation report  
**Audience:** client sponsor, operations managers, field officers, engineering, independent security reviewer, UAT participants

> **Change-control notice:** This specification describes the proposed _target_ system. It does not assert that every capability is built, contractually included, secure for real farmer data or deployable. The 71 decisions are provisional; exact client organizational names, approved role matrix, thresholds, legal notices, price, schedule and signed baselines are outstanding. Existing accepted architecture remains authoritative until reviewed ADRs supersede it. ADR 0021 is NOT Accepted and offline enrollment is not authorized for real officers.

## 1. Document control and approval

| Control                         | Value                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| Specification lifecycle         | Draft → owner review → client/security reconciliation → signed baseline → change controlled |
| Business approver               | TBD — named authorized representative of managing agricultural organization                 |
| Technical approver              | TBD — developer architecture lead; independent security reviewer for high-risk features     |
| Legal/privacy approver          | TBD — client-appointed competent privacy/legal advisor                                      |
| Implementation/repository       | `SandaruWithanage/agri-operations-platform`, default branch `main`                          |
| Engineering evidence baseline   | `docs/development/PHASE_1_STATUS.md` and living task register, not completion certification |
| Earlier owner decision evidence | 71-item register `AGRI_71_PROVISIONAL_DECISION_REGISTER.md`                                 |
| Source conflict log             | `AGRI_GITHUB_RECONCILIATION.md` (22 findings)                                               |
| Document status                 | Proposal; all 71 decisions awaiting client confirmation                                     |

**Priority legend.** `MUST` means a proposed first-release obligation if accepted by the client; `SHOULD` means preferred implementation or candidate requiring explicit agreement; `TBD` blocks a binding implementation or SLA. Requirement IDs are immutable in the approved specification. Q-numbers trace to the decision register; historic source documents must be retained with separate precedence records.

**Approval evidence expected:** approver name/role; dated signed SRS version and appendix list; risks accepted/refused; exact planned pilot users/devices; agreed acceptance thresholds and budget; authoritative source-plan correction; signed data-processing responsibilities; acceptance criteria; change-control baseline ID.

## 2. Introduction

### 2.1 Purpose

Specify verifiable functional behavior, data controls, external interactions, non-functional quality, security and acceptance evidence for a single-operator Sri Lankan agricultural operations platform. This document guides design, delivery estimates, implementation contracts, UAT and versioned changes; it is not a legal land registry or a binding financial settlement agreement.

### 2.2 Business objective

Replace fragmented paper and spreadsheet processes with a centralized, controlled record of farmers, land and relationships, configurable agricultural projects, field work, resource distribution, mapped coverage and performance analytics. Allow authorized field officers to prepare useful work during unreliable connectivity while preserving least-privilege access, accurate provenance and authoritative server-side validation.

### 2.3 Proposed release boundary

**Proposed first release:** office administration, field officer PWA, authenticated coordinators only when specifically granted; configurable organizational/geographic/project model; farmer registration/verification; land relationships and _full_ GIS, including polygon editing, walk-the-boundary GPS and offline conflict handling; enrollment/lifecycle and dependent offline creation; auditable inventory and offline issues; comprehensive reports, analytics and exports; bilingual interfaces; device and privileged security; migration, UAT, hosting/operations and initial developer training.

**Not automatically in scope:** farmer self-service portal, harvest procurement/transport/biomass weighing, loan processing and bank settlement, insurance administration, e-signature legal certification, biometric tracking, satellite crop classification, autonomous AI decisions, official legal cadastre or multi-company SaaS tenancy. Supplied buyback/finance examples do not authorize these modules. Optional field visits, CBO membership, agreement metadata, plans and target versions appear in earlier working source; confirm their release priority and detailed workflows independently.

### 2.4 Source precedence and known conflicts

1. An explicit **signed client SRS/change order** outranks an earlier unsigned source only to the extent documented.
2. Accepted architecture ADRs govern engineering until updated through technical review; a provisional owner policy never disables their safeguards implicitly.
3. 71 sequential owner decisions set proposed business direction. Q48 final **B (full GIS)** supersedes earlier Q48 C; Q52 adds walk-based perimeter capture; Q3 proposes same-session offline farmer→enrollment and conflicts with ADR 0021's confirmed-farmer-only rule.
4. Original master-package requirements and GitHub implementation status remain separately cited, not silently rewritten.
5. The 2026/27 plan printed total 2,700 vs category sum 2,760 remains an unresolved business-source discrepancy (DEC-10).

### 2.5 Terminology

- **Farmer:** business identity, independent of person/login and project enrollment.
- **Parcel/plot:** geographically referenced land business record; `boundary` is a versioned asserted geometry, not proof of legal title.
- **Cycle:** continuous or seasonal project period, versioned and policy-controlled.
- **Authoritative area:** validated measure chosen by versioned project policy; may differ from mobile-GPS estimate.
- **Offline intent:** encrypted queued proposed mutation with no guaranteed server result.
- **RPO:** maximum proposed data-loss window after disaster; **RTO:** proposed time to restore service.
- **RBAC + ABAC:** roles permit actions, and current attributes/scopes restrict resources; all effective checks remain server/database authoritative.
- **UAT:** real-world client acceptance tests with recorded evidence and sign-off.

## 3. Product context, users and environment

### 3.1 User classes

| Class                                         | Typical duties                                                         | Essential access boundary                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Client organization head / authorized sponsor | Sponsor, acceptance, organization-level policy review                  | No automatic data access merely by job title; permissions are explicit           |
| System/organization administrator             | Account, role, device, operational configuration, approved exceptions  | Named action grants, dual approval for high-risk changes, full audit             |
| Project manager                               | Configure project/cycle/enrollment policies, coverage, quotas, reports | Assigned project/geography; cannot see unrelated farmer records                  |
| Field officer                                 | In-person farmer capture, GPS survey, resource distribution, sync      | Approved device, current assignment, minimal offline dataset, explicit mutations |
| Coordinator/CBO representative                | May be a contact-only person or permitted account                      | No access without explicit account and scoped grant                              |
| Inventory custodian/receiver                  | Receipts, stock verification, transfers, discrepancies                 | Assigned stock locations and authenticated source/recipient confirmation         |
| Reviewer/survey verifier                      | Review land evidence, boundary quality, overlap dispute                | Separate verification permissions, no inferred title authority                   |
| Auditor/privacy reviewer                      | Restricted audit/report/review activity                                | Independent permission, purpose/retention bounds                                 |
| Farmer/guardian/external party                | Business record in first release                                       | No self-service account or login by default; future change required              |

A single human may be assigned several duties but must not inherit broad permissions automatically. The client must supply its exact permission matrix and the identities of the high-risk two-person approvers.

### 3.2 Operating environment

- **Office:** desktop/laptop browsers, Next.js administration dashboard, TLS-protected authenticated sessions.
- **Field:** mobile-first installed PWA in approved supported Android/browser combinations; intermittent connection; WebCrypto/IndexedDB, device screen lock and secure handling subject to actual device validation.
- **Server:** Dockerized Next.js applications and NestJS, restricted PostgreSQL 17/PostGIS 3.5 baseline, object storage for permitted evidence/report artifacts, encrypted offsite backup, guarded network access on a developer-operated VPS.
- **Locale:** English and Sinhala visible switch; source name strings and documents are never silently machine translated.
- **External services:** chosen permitted tile provider/offline-map distribution, notification/email messaging if contracted, managed offsite storage and support alert channels.

### 3.3 Dependencies and assumptions

The client will provide domain decision-makers, geographic master-data definitions, source-plan reconciliation, pilot phones/OS/browser inventory, map licences, allowed device controls, data-controller/processor terms, notice wording, retention and support owners. Browser storage persistence, geolocation accuracy and background execution cannot be guaranteed without field evidence. Proposed capacity examples are not signed workload forecasts. The developer-operated VPS model does not transfer ownership of client data.

## 4. Workflow narratives and state boundaries

### W-01 — Authorized offline farmer registration + dependent enrollment

1. Officer signs in online on an individually approved device. The server supplies current minimal project/location choices, authorized actions and offline validity metadata.
2. Officer unlocks a separate encrypted vault; starts a farmer draft with minimum identity/geography/notice fields. Client and mutation UUIDs are persisted before any network send.
3. Without internet, officer saves the farmer and creates a linked pending enrollment intent for an eligible project in the same session, **even though the farmer is not yet server-confirmed** (Q3 target design; ADR change gate outstanding).
4. Local UI distinguishes `saved on this device` from `accepted by server`. All sensitive extra fields/docs stay absent unless separately authorized.
5. On reconnect and successful current-session/device authentication, the existing outbox sends `farmer.register`; waits for confirmed canonical result; only then sends dependent `enrollment.create` with stable child mutation ID.
6. On parent conflict/rejection, child becomes `blocked dependency`; operator reviews without data deletion or silent rekey. On server denial or policy change, operator sees an authorized safe reason and an actionable follow-up.
7. On commit-but-lost-response followed by revoked grant, client records `unconfirmed`; authorized administrator reconciles using restricted audit/reference lookup.
8. No offline action grants rights by virtue of merely creating the record.

### W-02 — Walk-the-boundary survey without connectivity

1. Authorized officer opens parcel survey, grants foreground geolocation permission and chooses `Start Boundary Survey`.
2. On-device GPS positions are sampled only while a visible survey session is active. For each point store lat/lon/time/reported accuracy and device/method metadata inside the encrypted vault.
3. UI shows recording, accuracy, last fix, provisional track and distance; may pause/resume. A path gap remains a marked gap rather than a fabricated boundary segment.
4. Officer ends the circuit, reviews any gaps/jumps, adjusts point positions with explicit edits, and saves the source track plus proposed polygon under configured raw-track retention.
5. The area is calculated with a geodesic-capable method and displayed in m², hectares and acres. It remains an _estimate_ pending project/survey verification; original reported/surveyed measurements remain distinct.
6. Reconnect performs geometry validity, area policy, version, overlap, current permission and scope checks. Conflicts preserve separate candidate versions for approved review. Verified/official status cannot be issued by a normal capture permission.

### W-03 — Offline agricultural resource distribution

1. Authorized stock custodian confirms dispatch and receiving officer independently confirms inventory receipt/partial receipt online.
2. Officer obtains approved preallocation/resource catalog and configured quotas on an individually approved device; only confirmed received allocations may be offered for offline issue.
3. Officer records resource, quantity/unit, farmer, project/cycle, lot, required officer confirmation and optional farmer acknowledgement. Device records provisional issue with stable IDs.
4. At sync, server rechecks account/device, farmer, enrollment status, allocation, confirmed stock, quota/area policy and previously posted issues under concurrency control.
5. Accepted issue posts an immutable stock movement and audit event. Conflict/oversupply remains visible for review, not silently overwritten or deducted twice.

### W-04 — Staff transfer, lost device and access revocation

1. Authorized administration changes an officer's assignment or revokes a device; server sessions and all protected requests are blocked under recalculated scope.
2. Offline device may still contain previously authorized ciphertext; no claim of instant remote erase is made. Local expiry/inactivity controls reduce exposure but cannot revoke already-decrypted data on a disconnected compromised phone.
3. Approved replacement requires independent device enrollment. Only server-synced data or properly configured encrypted recovery/archive can be restored. Missing backup/recovery material may make unsynchronized work irrecoverable.
4. Historical actor identities, mutation receipts and access-change logs remain intact.

## 5. System features and functional requirements

Every statement in this section is an **owner-proposed requirement** unless the final signed SRS explicitly adopts it. The adjacent acceptance clause is the minimum demonstrable behavior, not proof it currently passes. Technical IDs can be refined at controlled review without losing Q traceability.

### 5.1 Organizational model, identities and dynamic authorization — 15 requirements

**FR-ORG-001** · _Trace: Q18,Q61_. The system shall register one initial managing organization while keeping organization identity configurable and modeling third-party entities as related counterparties, not separate tenants.  
**Acceptance:** A configured organization administers many projects; partner entities cannot inherit organization-wide privileges.

**FR-ORG-002** · _Trace: Q61_. The system shall maintain configurable hierarchical organizational units, positions, coverage areas and external CBO records independently of fixed names or counts.  
**Acceptance:** A unit reassignment and a CBO with no account do not require database enum changes or a new organization.

**FR-ORG-003** · _Trace: Q61,Q64_. The system shall distinguish a person, login account, staff position, farmer business identity and effective-dated assignments.  
**Acceptance:** One person transfers roles without duplicate identity or rewritten historical actors.

**FR-ORG-004** · _Trace: Q17,Q18,Q61_. Organizational hierarchy and administrative geography shall be separate; rights shall reflect current effective assignments rather than residence alone.  
**Acceptance:** A moved staff member loses old-region reads while history remains intact.

**FR-ORG-005** · _Trace: Q61_. Authorized administrators shall manage organization, project and geography scopes through guarded, audited services, not unrestricted table writes.  
**Acceptance:** Direct restricted SQL is denied; valid request maintains hierarchy and assignment consistency.

**FR-ORG-006** · _Trace: Q61,Q62_. Each business operation shall require an explicit action permission evaluated against actor, resource, organization, project, geography and relevant relationship.  
**Acceptance:** Matrix verifies AND intersections and denies out-of-scope combinations.

**FR-ORG-007** · _Trace: Q61,Q62_. Scope sets shall apply all clauses conjunctively; alternative grants may be considered disjunctively only as independently valid sets.  
**Acceptance:** A Zone-A-and-Project-1 grant never becomes Zone-A-or-Project-1.

**FR-ORG-008** · _Trace: Q61,Q62_. Role/grant administration shall be database-configurable using `role.create`, `role.update`, `permission.grant`, `user.role.assign` or reviewed equivalent action IDs.  
**Acceptance:** Client adds a role without source edits; no grant exceeds delegator authority.

**FR-ORG-009** · _Trace: Q62_. High-risk grants shall require two distinct authorized approvers, no requester self-approval, and protected risk classification.  
**Acceptance:** One approver cannot activate restricted exports; reclassifying risk needs independent control.

**FR-ORG-010** · _Trace: Q63_. Temporary grants shall have validity windows, justification, automatic expiry and audited approvals; emergency elevation shall use stronger authentication, short duration and independent review.  
**Acceptance:** Expired grant is denied at PostgreSQL even with stale frontend cache.

**FR-ORG-011** · _Trace: Q64_. Transfer, suspension, departure and reassignment shall recalculate authorization, revoke impacted server sessions and preserve prior provenance.  
**Acceptance:** Historical actor retains identity while old-region access is denied.

**FR-ORG-012** · _Trace: Q65_. System shall schedule configurable risk-based access reviews: proposed quarterly for privileged, six-monthly for ordinary, plus event-driven review.  
**Acceptance:** Reviewer records retain/modify/revoke outcome and overdue reminders.

**FR-ORG-013** · _Trace: Q66_. Privileged accounts shall use MFA, others risk-based MFA; high-risk operations shall require fresh step-up verification.  
**Acceptance:** Unauthorized bypass and stale step-up are rejected; recovery is audited.

**FR-ORG-014** · _Trace: Q41_. Device administration shall be separately granted through `device.view`, `device.approve`, `device.revoke` with no self-approval.  
**Acceptance:** Operator lacking device.approve cannot enroll their own browser profile.

**FR-ORG-015** · _Trace: Q7,Q61_. Enrollment withdrawal shall require separate `enrollment.withdraw`, provisionally administrator-delegated at pilot, with future roles allowed by reviewed policy.  
**Acceptance:** Field-source direct withdrawal is denied until separately approved; authorized withdrawal retains history.

### 5.2 Farmer registration, identity, verification and lifecycle — 12 requirements

**FR-FARM-001** · _Trace: Q32_. Create a farmer business identity with stable server/client UUID, name in at least one supported language, configured village/GN, creator/source/time and notice-delivery evidence.  
**Acceptance:** Missing optional phone/NIC does not block valid minimum registration.

**FR-FARM-002** · _Trace: Q32,Q35_. Identity numbers, contacts, bank details and other sensitive attributes shall be optional separate protected categories rather than mandatory base-profile fields.  
**Acceptance:** Basic-read user cannot retrieve the fields by detail, search, export or error payload.

**FR-FARM-003** · _Trace: Q32_. Project-specific farmer forms shall use versioned templates, conditional required fields only after client-approved purpose and validation policy.  
**Acceptance:** Historical submission remains interpretable after a template update.

**FR-FARM-004** · _Trace: Q67_. System shall support candidate duplicate detection, review and linking without silent merging of distinct farmers.  
**Acceptance:** Duplicate candidate is flagged; original source identifiers and audit are preserved.

**FR-FARM-005** · _Trace: Q17_. Farmers shall support pending-review, verified, inactive and other approved status transitions with reasons, effective dates and audit.  
**Acceptance:** Transition requires allowed scope and version; prior status remains reportable.

**FR-FARM-006** · _Trace: Q17,Q64_. Farmer geography corrections shall change visibility and assignment-based access atomically without rewriting history or auto-withdrawing project enrollment.  
**Acceptance:** Officer outside new scope cannot read or correct on next request.

**FR-FARM-007** · _Trace: Q32,Q33_. Registration shall record delivery of the current approved bilingual privacy notice, including authorized verbal-delivery indication when applicable.  
**Acceptance:** Notice ID/version/language/delivery method/date preserved with actor.

**FR-FARM-008** · _Trace: Q33_. Additional purpose-specific consent shall be tracked separately where approved legal basis/policy requires it.  
**Acceptance:** Withdrawal of optional consent stops affected optional processing subject to lawful holds and policy.

**FR-FARM-009** · _Trace: Q35_. Sensitive identity reads shall be masked by default and require explicit purpose/scope-bound grants with audited reveal.  
**Acceptance:** User with farmer.read alone sees only masked/omitted values.

**FR-FARM-010** · _Trace: Q67_. The system shall preserve original registration sources and migration lineage for imported farmers, including import batch and row reference.  
**Acceptance:** A duplicate import is idempotent and source record remains traceable.

**FR-FARM-011** · _Trace: Q18,Q19_. Farmer residence/registration geography shall not be assumed to equal parcel geography, cultivator rights or project allocation.  
**Acceptance:** Separate records can hold different valid areas and distinct effective dates.

**FR-FARM-012** · _Trace: Q34_. Retired/inactive farmer records shall obey approved retention, legal holds and pseudonymization/erasure policies without destroying transaction integrity.  
**Acceptance:** Attempted delete while on hold is refused and logged.

### 5.3 Land relationships, full GIS and perimeter capture — 20 requirements

**FR-LAND-001** · _Trace: Q18_. Each land parcel shall have identity, separately configured administrative geography, creator/time, description and version, independent of current farmer address.  
**Acceptance:** Parcel may be registered with no title documents while minimum identity/geography rules pass.

**FR-LAND-002** · _Trace: Q19_. Parcel-person relationships shall include configurable owner, tenant, cultivator, manager and other client-approved types with effective dates, source and review status.  
**Acceptance:** Multiple people share a parcel without overwriting relationships; relationship is not title proof.

**FR-LAND-003** · _Trace: Q20_. Required land evidence shall be configurable by project/relationship; basic land intake shall remain possible without supporting documents.  
**Acceptance:** Lack of attachment creates pending evidence state, not automatic rejection of base record.

**FR-LAND-004** · _Trace: Q48_. First-release GIS shall render scope-filtered interactive basemaps, farmer/parcel pins, polygon layers and configurable project/region overlays.  
**Acceptance:** Two-officer map tests reveal no unauthorized marker, count, tile overlay or boundary.

**FR-LAND-005** · _Trace: Q48_. Authorized users shall draw, edit and import parcel boundary polygons with validation, history and per-action authorization.  
**Acceptance:** Invalid polygon is flagged; original approved version preserved on attempted edit.

**FR-LAND-006** · _Trace: Q49_. Boundary versions shall track GPS, digitized and official-survey sources, accuracy, recorded/surveyed dates, actor, evidence and verification state.  
**Acceptance:** Provisional phone polygon is clearly distinguishable from approved survey.

**FR-LAND-007** · _Trace: Q49_. Boundary states shall support provisional, review, verified, disputed and superseded outcomes, with separate permission for verification.  
**Acceptance:** Editing boundary does not silently set legal-verified status.

**FR-LAND-008** · _Trace: Q52_. Store reported, legally surveyed and GIS-calculated areas separately, with original unit, source, version and validation status.  
**Acceptance:** 2.0-acre recorded and 2.3-acre GIS area remain independently retrievable.

**FR-LAND-009** · _Trace: Q52_. Configurable project policy shall select which validated area is authoritative for eligibility and quota calculations, with historical effective versions.  
**Acceptance:** Quota uses configured validated measure, not latest unapproved GPS polygon.

**FR-LAND-010** · _Trace: Q52,Q53_. Field officers shall be able to initiate a walk-the-boundary session that samples GPS as they walk and derives a proposed polygon and area.  
**Acceptance:** Complete visible-foreground walk can produce a reviewable polygon without manual point-by-point drawing.

**FR-LAND-011** · _Trace: Q53_. Tracking shall support explicit start/stop/pause/resume, display accuracy, and warn about stale fixes, anomalous jumps and incomplete closure.  
**Acceptance:** Interruption does not silently bridge a gap or accept a low-confidence segment.

**FR-LAND-012** · _Trace: Q53_. Officer shall be able to review and manually correct GPS points/segments without destroying the underlying survey provenance.  
**Acceptance:** Correction records prior version and reason before provisional save.

**FR-LAND-013** · _Trace: Q50_. Authorized offline boundary capture/edit shall write encrypted local survey drafts and queued geometry mutations, with stable IDs and schema versions.  
**Acceptance:** Offline restart preserves edits; reconnect uses original IDs and succeeds or surfaces conflict.

**FR-LAND-014** · _Trace: Q50_. The server shall validate polygon geometry, area, tenant/org boundary, current permissions, expected version and allowed transitions before accepting GIS mutation.  
**Acceptance:** Cross-region or self-intersecting geometry cannot bypass guarded write endpoint.

**FR-LAND-015** · _Trace: Q55_. Overlap detection shall calculate candidate overlap area and affected parcel identities only within the reviewer's authorized scope.  
**Acceptance:** Intentional overlap flagged; no unauthorized neighboring parcel details leaked.

**FR-LAND-016** · _Trace: Q55_. Overlapping parcels may be saved provisionally but conflicted portions shall not become verified/allocatable without permitted resolution.  
**Acceptance:** Dispute remains visible until authorized review; quota cannot double-count unapproved area.

**FR-LAND-017** · _Trace: Q54_. Raw GPS tracks shall be purpose-limited survey evidence, stored only per configured retention and explicit survey activation, separate from final geometry.  
**Acceptance:** No location collection outside active survey; retention expiration removes eligible tracks without deleting polygon.

**FR-LAND-018** · _Trace: Q51_. Map provider configuration shall be replaceable; offline basemap downloads require a documented rights-approved source and area limit.  
**Acceptance:** Disallowed provider cannot be bulk-cached; attribution/license recorded.

**FR-LAND-019** · _Trace: Q48_. GIS shall support spatial filtering, area summaries, overlap and coverage analysis with scope-aware statistics and export permissions.  
**Acceptance:** Region A viewer cannot deduce Region B totals via cross-filter aggregation.

**FR-LAND-020** · _Trace: Q49,Q52_. GIS area and GPS confidence shall be represented as estimates unless verified survey status supports stronger designation.  
**Acceptance:** User sees uncertainty/source; system never labels mobile GPS output cadastral proof.

### 5.4 Project management, lifecycle and farmer enrollments — 20 requirements

**FR-PROJ-001** · _Trace: Q9_. Farmers may have more than one current enrollment across projects where separately eligible.  
**Acceptance:** Enroll Project A then B; two current enrollments valid under distinct project policies.

**FR-PROJ-002** · _Trace: Q9,Q15_. Duplicate current enrollment within the same project/cycle policy shall be rejected, while new row after withdrawal or eligible renewal is allowed.  
**Acceptance:** Concurrent duplicate attempts yield one authoritative active record and auditable outcome.

**FR-PROJ-003** · _Trace: Q10_. Projects shall be configurable as continuous or seasonal, with separately versioned cycles, start/end dates and statuses.  
**Acceptance:** Same project definition supports both policy models without schema fork.

**FR-PROJ-004** · _Trace: Q11_. Renewal policy shall be per project; proposed pilot seasonal cycles require a new enrollment and continuous membership persists.  
**Acceptance:** Rollover never silently creates an approved enrollment.

**FR-PROJ-005** · _Trace: Q12_. Project/cycle closure shall be manual by authorized users in pilot, with configurable closure policy and end-date warnings.  
**Acceptance:** Date passage alone does not change status before approved action.

**FR-PROJ-006** · _Trace: Q8_. Per-project approval mode shall be versioned; pilot activation after validation, with configurable review/approval workflow for later projects.  
**Acceptance:** Immediate path and approval-required path each reject unauthorized actor.

**FR-PROJ-007** · _Trace: Q13_. Enrollment shall record observed field-event time, server receipt/confirmation time and configurable official effective time, pilot default server confirmation.  
**Acceptance:** Device clock shift does not rewrite authoritative server timestamp.

**FR-PROJ-008** · _Trace: Q14_. Per-project prerequisites shall configure eligible farmer statuses; proposed pilot allows pending-review/verified and denies inactive.  
**Acceptance:** Decision reevaluated on each offline sync, not only when queued.

**FR-PROJ-009** · _Trace: Q16_. If enrolled farmer becomes ineligible/inactive, flag current enrollment for review without auto-withdrawal; benefit restrictions follow project policy.  
**Acceptance:** Prior history retained and issue eligibility enforced separately.

**FR-PROJ-010** · _Trace: Q17_. Farmer geography changes shall trigger scope recalculation and coverage exceptions without automatic membership deletion.  
**Acceptance:** Former officer loses view, authorized project manager sees review flag.

**FR-PROJ-011** · _Trace: Q18_. Each project shall define whether eligibility geography follows farmer registration or a linked parcel/plot location.  
**Acceptance:** Changing policy version affects new evaluations with tracked provenance.

**FR-PROJ-012** · _Trace: Q1_. `enrollment.create` shall require current session, permission, project assignment, geography intersection, farmer.read and enabled project eligibility policy.  
**Acceptance:** A project-only or region-only grant is insufficient where both required.

**FR-PROJ-013** · _Trace: Q2_. Authorized officers may queue enrollment intents offline and synchronize them automatically after valid reconnection or via Sync Now.  
**Acceptance:** Queue shows pending/not-guaranteed; server may reject when policy changed.

**FR-PROJ-014** · _Trace: Q3_. An officer may create an offline enrollment dependent on a newly queued farmer registration in the same vault.  
**Acceptance:** Sync creates/authorizes farmer first, then evaluates dependent enrollment exactly once with stable IDs.

**FR-PROJ-015** · _Trace: Q3_. A rejected/conflicted farmer registration shall prevent dependent enrollment submission and show blocked-dependency recovery without deleting the child intent.  
**Acceptance:** Parent rejection leaves child local and actionable; no phantom enrollment row.

**FR-PROJ-016** · _Trace: Q4_. Refusal responses shall show authorized officers safe actionable reason categories without revealing confidential policy or other actors' records.  
**Acceptance:** Revoked officer receives only generic denial; authorized admin can review scoped detailed reason events.

**FR-PROJ-017** · _Trace: Q5_. Queue shall cap unresolved enrollment intents at 100/account/device with warning at 80; never delete unsent items to free capacity.  
**Acceptance:** 101st blocked with recovery UI; first 100 intact.

**FR-PROJ-018** · _Trace: Q6_. Unresolved enrollment queue entries shall warn at seven days and escalate at 30 days, without age-based deletion.  
**Acceptance:** Simulated overdue local vault shows warning; no claim of server-visible alert while disconnected.

**FR-PROJ-019** · _Trace: Q7_. Enrollment withdrawal shall be an explicit audited state transition with reasons and separate privileges, leaving immutable historical row.  
**Acceptance:** Authorized withdrawal followed by eligible re-enrollment creates a fresh row.

**FR-PROJ-020** · _Trace: Q14,Q16_. Project benefit allocation shall recheck current farmer/project/cycle status and any hold, not equate enrollment existence to unconditional entitlement.  
**Acceptance:** Ineligible status blocks configured distribution even when enrollment record remains active.

### 5.5 Resource catalog, inventory ledger and distribution — 15 requirements

**FR-INV-001** · _Trace: Q21_. Resource catalog shall support configurable types, units, categories and organization/program applicability without hardcoding crop types.  
**Acceptance:** Admin registers seeds, seedlings and fertilizer units under approved policy.

**FR-INV-002** · _Trace: Q21_. Every stock-affecting receipt, issue, transfer, return, loss, damage, correction or adjustment shall create an immutable auditable ledger event.  
**Acceptance:** Stock balance can be reconstructed from posted events and corrections never erase original.

**FR-INV-003** · _Trace: Q22_. Officers may distribute only authorized, already allocated stock while offline, and each issuance stays provisional until server confirms.  
**Acceptance:** Offline negative/duplicate/cross-scope issue is not silently committed.

**FR-INV-004** · _Trace: Q23_. Officer confirmation shall be mandatory at pilot; farmer acknowledgment method shall be configurable per resource/project and optional by default.  
**Acceptance:** No biometric required; absence of optional acknowledgment is recorded without inventing signature.

**FR-INV-005** · _Trace: Q24_. Loss and correction transactions shall require approved pilot authorization; returns shall require physical receipt verification and separate events.  
**Acceptance:** Unauthorized adjustment denied, original stock journal retained.

**FR-INV-006** · _Trace: Q25_. Each resource shall define authoritative base unit and allowed conversion factors with version/effective date.  
**Acceptance:** Ten plants stored integer; mass uses decimal and invalid conversion fails.

**FR-INV-007** · _Trace: Q25_. Every quantity-affecting event shall preserve entered quantity/unit and validated normalized base quantity in exact numeric types.  
**Acceptance:** Same movement reproduces identical normalized quantity after conversion version changes.

**FR-INV-008** · _Trace: Q26_. Inter-location transfers shall require sender dispatch and receiver receipt confirmation, including partial receipts and discrepancies.  
**Acceptance:** Stock in transit not eligible for new offline officer allocation before receipt confirmation.

**FR-INV-009** · _Trace: Q27_. Resource-specific lot tracking shall capture source, batch ID, relevant dates/expiry and traceability to individual farmer issues when enabled.  
**Acceptance:** Query reconstructs batch-to-farmer distribution without unrestricted report leakage.

**FR-INV-010** · _Trace: Q28_. Quotas shall be configurable by project, resource, cycle, farmer category and approved area, with effective policy version.  
**Acceptance:** Over-limit issuance rejected at server; provisional offline status disclosed.

**FR-INV-011** · _Trace: Q28,Q52_. Validated authoritative parcel area shall be used for area-based quotas; disputed/unverified area shall not inflate eligible quantity.  
**Acceptance:** A disputed 0.2 acre overlap does not add quota without approved decision.

**FR-INV-012** · _Trace: Q22_. Offline distribution sync shall use stable mutation IDs, stock allocation version and expected balance/ceiling checks, preserving conflicts for reconciliation.  
**Acceptance:** Two disconnected officers cannot both confirm the same finite allocation at server.

**FR-INV-013** · _Trace: Q24_. Corrections and reversals shall be compensating transactions linked to original events with reason, approver and audit.  
**Acceptance:** Reversal changes balance without UPDATE/DELETE on ledger rows.

**FR-INV-014** · _Trace: Q26_. Transfers and allocation receipts shall expose statuses proposed, dispatched, partially received, received, disputed and reconciled as supported by approved transitions.  
**Acceptance:** Full and partial receipt histories remain inspectable.

**FR-INV-015** · _Trace: Q21_. Inventory queries, transfers and distribution exports shall honor current RBAC+ABAC, restricting balances by location/project and farmer/lot details by purpose.  
**Acceptance:** Authorized officer sees own preallocation, not all warehouse holdings.

### 5.6 Reports, analytics and planning — 12 requirements

**FR-RPT-001** · _Trace: Q29_. First release shall include comprehensive role-specific dashboards, charts, KPI summaries, configurable filters and time-series or distribution reports.  
**Acceptance:** Test approved stock, enrollment, area and farmer measures against authoritative transaction fixtures.

**FR-RPT-002** · _Trace: Q29_. The system shall support customizable report definitions and scheduled execution without exposing arbitrary SQL or bypassing database security.  
**Acceptance:** User-defined report cannot read hidden table/tenant through filter or aggregation.

**FR-RPT-003** · _Trace: Q29_. Reports shall support authorized export to Excel, CSV and PDF, with complete Sinhala/English labels where required.  
**Acceptance:** Export count, grouping, numeric units and date filters match authorized on-screen results.

**FR-RPT-004** · _Trace: Q30_. Distinct permissions shall govern dashboard.view, report.view, report.export, report.schedule and sensitive report categories.  
**Acceptance:** View grant alone cannot export, schedule or download a restricted report.

**FR-RPT-005** · _Trace: Q31_. Delivery channels shall include dashboard retrieval, notifications and authenticated expiring links; sensitive attachments only per policy.  
**Acceptance:** Old/forwarded link fails after revoked permission, expiry or account mismatch.

**FR-RPT-006** · _Trace: Q31,Q35_. Downloads shall reauthorize actor and scope on use and generate export/download audit entries.  
**Acceptance:** User with permission revoked after scheduling cannot retrieve newly generated sensitive export.

**FR-RPT-007** · _Trace: Q29_. KPI definitions shall specify source tables, effective date, inclusion/exclusion states, aggregation and unit before client acceptance.  
**Acceptance:** Example count excludes retired/unconfirmed events per versioned definition.

**FR-RPT-008** · _Trace: Q52,Q55_. GIS reports shall separate estimated, surveyed, validated and disputed land areas rather than silently summing overlapping polygons.  
**Acceptance:** Report shows distinct categories and flags scope-specific overlap uncertainty.

**FR-RPT-009** · _Trace: Q29_. Scheduled report execution shall use authenticated service jobs with recipient authorization rechecks and retained delivery outcomes.  
**Acceptance:** Recipient losing grant receives no sensitive attachment on next schedule.

**FR-RPT-010** · _Trace: Q56_. Plan targets shall retain approved/draft source versions and unresolved arithmetic issues; do not turn a printed incorrect total into confirmed actual.  
**Acceptance:** Source plan 2,700 vs sum 2,760 remains blocked from final KPI baseline until approved correction.

**FR-RPT-011** · _Trace: Q29,Q51_. Map-based analytics and spatial reporting shall use scope-filtered queries and approved basemap/imagery providers.  
**Acceptance:** No hidden geography count or polygon via report tiles or drilldowns.

**FR-RPT-012** · _Trace: Q30_. Report customizations shall be limited to allowed measures/dimensions for the user's context, with bounded query cost.  
**Acceptance:** Unauthorized measure unavailable and query hits configured safeguards.

### 5.7 Offline workspace, synchronization and device controls — 16 requirements

**FR-OFF-001** · _Trace: Q36_. Device offline vault shall store only separately authorized minimum data and exclude NIC, financial details and sensitive documents by default.  
**Acceptance:** Storage inspection shows encrypted minimal records only, no disallowed categories or browser tokens.

**FR-OFF-002** · _Trace: Q37_. Both BYOD and organization devices may be individually approved subject to minimum security checks; offline is restricted when posture cannot be verified.  
**Acceptance:** Unknown/unsupported browser cannot create offline draft; safe recovery of existing ciphertext remains possible.

**FR-OFF-003** · _Trace: Q38_. Offline authoring shall have configurable policy-bound maximum, proposed pilot seven days since successful online authentication.  
**Acceptance:** Expired offline authoring locks new edits and never auto-deletes unresolved data.

**FR-OFF-004** · _Trace: Q38_. Offline vault shall use local unlock and inactivity locking independently of server login; sync requires fresh live server authorization.  
**Acceptance:** Local unlock after revocation cannot obtain new server access.

**FR-OFF-005** · _Trace: Q39_. Lost device shall trigger server session/device revocation, audited replacement approval and encrypted recovery only from accessible approved sources.  
**Acceptance:** New device requires reapproval; disconnected lost phone is not claimed remotely erased.

**FR-OFF-006** · _Trace: Q40_. Optional vault recovery-key mechanism shall be preconfigured, encryption-preserving, controlled by approval and separately security-reviewed before enabled.  
**Acceptance:** Missing recovery material cannot be bypassed by admin password reset.

**FR-OFF-007** · _Trace: Q2,Q22,Q50_. Farmer, dependent enrollment, authorized distribution and GIS mutations shall use one durable per-account/device encrypted outbox, not competing sync engines.  
**Acceptance:** Each mutation has stable IDs and survives normal browser restart.

**FR-OFF-008** · _Trace: Q3_. Offline dependency graph shall topologically order farmer creation before dependent enrollment and preserve dependency on retries/conflicts.  
**Acceptance:** Parent success maps canonical farmer ID; child never sent against nonexistent farmer.

**FR-OFF-009** · _Trace: Q50_. Offline GIS edits shall use expected geometry version and conflict queues rather than last-write-wins for authoritative boundaries.  
**Acceptance:** Two officers' concurrent edits retain both proposed versions for review.

**FR-OFF-010** · _Trace: Q22,Q28_. Offline distribution may not create authoritative inventory balance until server validates allocation, quota, physical receipt and current scope.  
**Acceptance:** Local UI marks record pending and stock ledger remains server authoritative.

**FR-OFF-011** · _Trace: Q2,Q6_. Sync shall support automatic reconnect retry with bounded backoff, manual Sync Now and durable states for pending, synced, rejected, conflict and unconfirmed.  
**Acceptance:** Lost response replays same ID and creates no duplicate authoritative row.

**FR-OFF-012** · _Trace: Q4_. Offline synchronization shall distinguish authentication failure, authorization denial, business conflict, invalid payload and uncertain post-send outcome.  
**Acceptance:** Commit-then-revoke yields unconfirmed rather than false rejected or success.

**FR-OFF-013** · _Trace: Q5,Q6_. Queue saturation/age notices shall be local-first, with server-visible escalation only after an approved reconnect-time message.  
**Acceptance:** Fully disconnected device creates no fictitious server alert.

**FR-OFF-014** · _Trace: Q37,Q39_. Account/device partitions, non-exportable possession keys where supported, key binding and revocation status shall be enforced before sync.  
**Acceptance:** Vault/account swap and wrong device session fail closed.

**FR-OFF-015** · _Trace: Q70_. Client schema migrations and releases shall preserve pending vault records, support staged upgrades and tested rollback recovery.  
**Acceptance:** Old vault to new reader retains encrypted data and stable mutation IDs.

**FR-OFF-016** · _Trace: Q39,Q40_. Offline archive/recovery shall preserve all unresolved drafts and their dependencies, verify archive integrity and authorization, and block unsafe cross-account/device import.  
**Acceptance:** Tampered archive fails and original preserved; no unauthorized device restore.

### 5.8 Privacy, documents, imports and contractual data rights — 12 requirements

**FR-DATA-001** · _Trace: Q33_. Approved privacy notices shall be language-versioned and reviewable; UI shall record notice delivery without assuming consent equals every legal basis.  
**Acceptance:** Data has purpose-notice version and legal review record.

**FR-DATA-002** · _Trace: Q34_. Retention shall be configurable by data category with archive, anonymize, delete and legal-hold workflows; irreversible deletion disabled until approved rules.  
**Acceptance:** Retention job skips held records, logs preview and authorization.

**FR-DATA-003** · _Trace: Q35_. Sensitive fields and document reads shall be purpose-bound, masked by default, separately authorized and audited.  
**Acceptance:** Direct endpoint, search, report and export attack paths cannot bypass masking.

**FR-DATA-004** · _Trace: Q20,Q32_. Documents shall have separate metadata, encrypted object storage, document types, evidence status, versioning, permitted relationship and access scope.  
**Acceptance:** Access to farmer profile does not automatically grant document download.

**FR-DATA-005** · _Trace: Q54_. Raw survey tracks shall have shorter configurable retention than final polygons and shall not become continuous officer tracking.  
**Acceptance:** No GPS capture when survey off; audited scheduled removal under policy.

**FR-DATA-006** · _Trace: Q44_. Client shall control its business data while developer retains separately agreed software IP; standard authorized data export shall remain available.  
**Acceptance:** Signed termination procedure produces readable structured export without secret credentials.

**FR-DATA-007** · _Trace: Q44_. Contract exit shall propose a 30-day orderly handover window, subject to signed terms and legal retention.  
**Acceptance:** Data export, backups disposal/legal holds and deletion certificate steps documented.

**FR-DATA-008** · _Trace: Q67_. Import shall accept controlled CSV/Excel templates with mapping, validation preview, row-level errors and duplicate review.  
**Acceptance:** Bad rows cannot force all-or-nothing silent corruption; approved batch has source lineage.

**FR-DATA-009** · _Trace: Q67_. Import approvals, idempotency, rollback/compensation and correction shall be audited with source file hash and row mapping.  
**Acceptance:** Re-import same approved batch does not duplicate farmers or stock.

**FR-DATA-010** · _Trace: Q56_. Each requirement and change shall have source, version, owner, approval status and conflict resolution record.  
**Acceptance:** Conflicting sources produce flagged reconciliation item, not silent override.

**FR-DATA-011** · _Trace: Q57_. Change requests shall record technical, security, schedule and cost impacts and require both authorized client/developer approvals before contractual scope alteration.  
**Acceptance:** Unapproved request does not appear in approved baseline.

**FR-DATA-012** · _Trace: Q71_. Final SRS, architecture, roadmap, quotation and Sinhala client explanation shall be prepared before sign-off; all 71 choices remain provisional until then.  
**Acceptance:** Review package identifies approver/date/signature, bilingual what/why/how/duration/cost rationale and unresolved assumptions.

### 5.9 Deployment, operations, testing and handover — 12 requirements

**FR-OPS-001** · _Trace: Q42_. Initial production shall use portable Docker deployment on a cost-conscious VPS, with migration path to managed services.  
**Acceptance:** Restore/redeploy rehearsal on a new VM recovers service without undocumented personal machine dependency.

**FR-OPS-002** · _Trace: Q43_. Developer company shall own and operate hosting accounts/services and invoice client under agreed contract, distinct from data rights.  
**Acceptance:** Contracts and runbook list operator custodians and client data controller contact.

**FR-OPS-003** · _Trace: Q45_. Daily encrypted offsite backups plus feasible WAL archiving shall target proposed 1h RPO and 8h RTO only when restore tests substantiate.  
**Acceptance:** Restore exercise records observed RPO/RTO rather than claimed targets.

**FR-OPS-004** · _Trace: Q46_. Production secrets shall be in protected VPS environment files outside Git; cron-based rotation shall apply only to safely rotatable credentials with tested coordination.  
**Acceptance:** Rotation leaves both old encrypted data and new sessions recoverable; secrets absent from logs/artifacts.

**FR-OPS-005** · _Trace: Q47_. Monitoring shall cover VPS, API, database, backups, offline sync errors and escalation with sensitive-data sanitization.  
**Acceptance:** Failed backup/API unreachable results in correctly routed actionable alert.

**FR-OPS-006** · _Trace: Q58_. Structured UAT shall exercise approved requirements in real field conditions, classify severity and block critical security/integrity defects before written acceptance.  
**Acceptance:** UAT pack maps acceptance case to FR/NFR and client tester sign-off.

**FR-OPS-007** · _Trace: Q59_. English/Sinhala frontend and GIS interactions shall target WCAG 2.2 AA, with non-drag alternatives, keyboard use and field-device tests.  
**Acceptance:** Manual and automated checks pass documented target or have signed exception.

**FR-OPS-008** · _Trace: Q60_. Developer company shall deliver initial role-based training and basic manuals, with additional training separately scoped.  
**Acceptance:** Admin and officer can perform supervised critical field workflows after training.

**FR-OPS-009** · _Trace: Q68_. Rollout shall start with complete approved first-release modules in a bounded pilot, then expand only after acceptance gates and safe rollback plans.  
**Acceptance:** Pilot pass/fail and rollback drill signed before next region.

**FR-OPS-010** · _Trace: Q69_. Developer shall operate under recurring hosting/maintenance SLA with severity-based response targets and defined enhancements exclusions.  
**Acceptance:** Support contract separates incident response from new feature requests.

**FR-OPS-011** · _Trace: Q70_. Production CI/CD shall include staging, automated checks, explicit approval, safe versioned DB migrations, verified backups and offline-client compatibility.  
**Acceptance:** Bad migration aborts with no orphaned writes; old pending mutation can still sync.

**FR-OPS-012** · _Trace: Q71_. No work shall be described as fully approved or deployment-ready solely due to this provisional decision register.  
**Acceptance:** Approval table remains pending until authorized written client sign-off.

## 6. Data dictionary and record integrity

| Entity / aggregate                 | Core proposed attributes                                                                                            | Integrity, privacy and versioning requirements                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Person, account, role binding      | stable person ID, optional account ID, active/revoked state, MFA configuration, role assignment                     | Split real identity from account; no implicit access; effective-dated audited bindings                    |
| Organization, unit, geography, CBO | managing-entity ID, unit type/parent/closure, administrative area geometry, operational links                       | Distinct trees; no cyclic hierarchy; cross-organization FK enforcement                                    |
| Farmer                             | UUID, full name, alternate-language spelling when supplied, configured village/GN, status, creator, notice evidence | Optional NIC/contact; sensitive fields separate; version/audit; never silent duplicate merge              |
| Project / cycle                    | configured name/locale, project type, active flag, continuous/seasonal, cycle dates, status                         | Project catalog flag does not itself grant enrollment rights; versioned policy                            |
| Enrollment                         | UUID, farmer/project/cycle IDs, status, effective time, officer event time, server confirmation, policy version     | One current enrollment per project/cycle policy; independent from farmer registration; no history rewrite |
| Parcel / plot                      | land UUID, separate geographical area, basic label, farm relationship and recorded dates                            | Reported identity does not establish legal land title or official cadastral boundary                      |
| Boundary survey                    | survey UUID, raw-track reference, point accuracy, source, GPS permission context, recorded timestamps               | Encrypted during offline capture; purpose retention; pause/gap events and reviewed corrections            |
| Boundary version                   | geometry polygon/multipolygon in SRID 4326, area in m², method, verification state, previous version                | `ST_IsValid`, valid coordinate bounds, approved actor, overlap review, no automatic legal survey status   |
| Area measurement                   | measured/recorded/surveyed values, original unit, normalized area m², source/accuracy, reviewer                     | Project selects validated authoritative source; conflicting areas never silently overwritten              |
| Farmer-parcel relationship         | farmer ID, land ID, relationship type, effective window, evidence status                                            | Many-to-many and historical, no legal title inference                                                     |
| Resource and lot                   | resource ID, base unit, conversion version, batch/lot, source, relevant expiry                                      | Exact numeric quantities; lot tracking configurable per type                                              |
| Stock movement                     | immutable ledger ID, movement type, from/to, resource/lot, normalized quantity, linked target and original movement | Guards against negative or unauthorized holdings; compensating entries only                               |
| Offline intent                     | account/device partition, UUID mutation/entity IDs, dependency IDs, encrypted payload, state, base version          | Persist locally before network; idempotent replays; server authority; no credential storage               |
| Report definition/run              | scope-aware measure, filters, owner, run date, status, artifact reference, access audit                             | Scheduling not equal export permission; download reauthorized                                             |
| Document and notice                | classification, encrypted object key, version, source, purpose, consent/notice event                                | Restricted download, retention and full audit; no unapproved biometrics                                   |
| Import batch/source                | source type/file hash, row number, mapping version, preview/errors, approvals                                       | Idempotent and provenance-preserving correction / rollback                                                |
| Audit/event                        | actor, session/device context, policy version, action, related IDs, UTC time, reason and result                     | Append-oriented, integrity protected, minimization and retention controls                                 |

**Units and precision.** Maintain canonical square meters for areas (1 hectare = 10,000 m²; 1 international acre = 4,046.8564224 m²), with display units chosen by UI/report. Resource quantities use decimal/numeric base units and versioned conversions; integer-only rules apply to indivisible resources. A GPS coordinate's reported horizontal accuracy is not automatically an area-confidence interval or a legal survey tolerance.

**Historical read rule.** A changed project policy, area version, role assignment or conversion factor must not mutate old transaction meaning. Store relevant policy or conversion version and recorded effective times for retrospective reporting.

## 7. External interface requirements

### 7.1 User interfaces

- **Admin web:** dashboard, configured organizational/access administration, farmer registry/detail/review, parcel map/survey review, project/cycle policy and enrollments, stock ledger/transfers/allocations, report designer/view/export, audited imports, device/sync operations, approval and incident views.
- **Field PWA:** account/device sign-in, language switching, encrypted vault unlock, authorized reference refresh, farmer/land draft steps, foreground GPS walking survey, optional manual GIS correction, enroll-in-project, preallocated stock issue, queue/status center, conflict resolution and safe recovery.
- **Accessibility:** WCAG 2.2 AA target, keyboard/non-drag land-boundary alternatives, meaningful visible focus, labels, screen reader status and English/Sinhala validation. Text size/contrast and real Android viewport behavior must be observed.
- **Error semantics:** display network/sync and authorization denial separately; never reveal confidential policy or hidden records. Expired local access locks editing but preserves data for authorized recovery.

### 7.2 API / protocol

- Browser and PWA send authenticated same-origin HTTPS requests via a Next.js BFF; NestJS verifies sessions, actor, device, CSRF where applicable, and typed request fields. Never trust client-supplied role/source/organization identifiers as authority.
- API resources require separate capability checks: farmer, land, boundary survey/version, project/cycle/enrollment, stock ledger/transfer/allocation/issue, report, import, user/role/device, export and audit. API shape/version is a design artifact, not finalized by this SRS.
- Mutation bodies include caller-generated immutable `mutationId`, entity/client ID, expected version (where applicable), operation key, payload schema version and dependency links. Server returns stable receipt/denial class with safe message and opaque reference; it does not accept client `accepted` status.
- Export links are short-lived, scoped to recipient and reauthorized at use. Sensitive files reside outside public CDN paths.
- External basemap/imagery provider and notification provider are selectable under license/data-processing review; no unapproved offline tile scraping.

### 7.3 Hardware, platform and integration interfaces

- Device requirements: secure-context geolocation, supported WebCrypto/IndexedDB, local storage quota, approved device identity possession, Android/browser/PWA battery/background behavior; exact approved compatibility matrix TBD.
- GPS inputs: WGS84 lat/lon, fix timestamp, reported horizontal accuracy, optional speed/heading (not always reliable). No guaranteed sample frequency or background availability without evidence.
- PostgreSQL/PostGIS: constrained native SQL functions, FORCE RLS, GiST spatial indexes, exact NUMERIC inventory; database version baseline aligns with tested repository.
- Migration input/output: UTF-8 CSV, approved Excel templates, authenticated structured archival exports and PDFs, within data-protection restrictions.

## 8. Non-functional requirements

The following includes **owner-selected objectives** and **proposed engineering acceptance criteria**, all pending validation. Where no numeric user requirement exists, no numeric SLA is invented; provisional test configurations must be negotiated with client representatives before contractual use.

### 8.1 Security, privacy and assurance

**NFR-SEC-01** · _Trace Q35,Q61_. All protected reads/writes, aggregates, maps and exports shall be denied by default at service and PostgreSQL policy/function layers.  
**Verification:** Mutation-checked Officer A/B, cross-project/region, direct SQL/RLS negative suite.

**NFR-SEC-02** · _Trace Q66_. Privileged MFA, step-up and session revocation shall be enforced against current database identity and approved-device state.  
**Verification:** Authentication red-team cases for session fixation, CSRF, stale JWT/BFF, revoked device and MFA replay.

**NFR-SEC-03** · _Trace Q35,Q36_. Sensitive data shall be encrypted at rest and in transit; field-local vault shall use authenticated encryption and partition binding.  
**Verification:** Tamper, ciphertext swap, browser storage inspection, TLS downgrade and key-disclosure tests.

**NFR-SEC-04** · _Trace Q46_. Root and encryption-key rotation shall be controlled, atomic, recoverable and non-destructive; automatic cron rotation shall be limited to rehearsed eligible keys.  
**Verification:** Rehearsed rotation with old backups, active sessions and in-flight operations.

**NFR-SEC-05** · _Trace Q40_. Recovery shall not create an admin decryption backdoor; escrow/recovery keys, approvals and grant metadata must be separately protected.  
**Verification:** Independent crypto assessment, two-person approval where classified high-risk, wrong-approver denial.

**NFR-SEC-06** · _Trace Q33,Q34_. Data processing shall have recorded lawful purpose and reviewed Sri Lankan legal basis, privacy notices, retention schedules and external provider assessments.  
**Verification:** Legal sign-off plus data-flow inventory, breach test and retention audit.

**NFR-SEC-07** · _Trace Q47_. Logs shall exclude secrets, access tokens, full NIC, raw GPS trace and other unnecessary personal data.  
**Verification:** Automated log scanner and manual incident response review.

**NFR-SEC-08** · _Trace Q41,Q37_. Physical device posture checks must not be claimed if the PWA cannot attest them; unsupported or unverified controls restrict offline authoring.  
**Verification:** Acceptance checklist on actual models and adverse OS/browser settings.

### 8.2 Offline, resilience and geospatial field constraints

**NFR-OFF-01** · _Trace Q38_. Pilot offline authoring policy shall propose a 7-day maximum since trusted successful online authentication, in addition to local inactivity lock.  
**Verification:** Offline-clock manipulation, restart, sleep, storage reset and reconnect scenarios; unresolved limits documented.

**NFR-OFF-02** · _Trace Q2,Q3,Q50_. An interrupted/retried offline mutation shall retain stable identities and be idempotent; no confirmed success without authoritative receipt.  
**Verification:** Lost ACK, double replay, two-tab, crash-between-steps and cross-partition tests.

**NFR-OFF-03** · _Trace Q39_. Offline data shall survive ordinary restart/browser application updates where supported and remain recoverable after expiry without permitting new unauthorized edits.  
**Verification:** Browser restart/upgrade and encrypted backup restore on approved same partition.

**NFR-OFF-04** · _Trace Q53_. Survey capture shall visibly detect loss of position updates or low confidence, never invent a walked segment, and offer recovery.  
**Verification:** Test screen-off, background tab, battery saver and GPS permission removal on devices.

**NFR-OFF-05** · _Trace Q51_. Offline map package download shall be limited to authorized areas with rights-verified provider terms and bounded storage quota.  
**Verification:** License checklist, package integrity test, user storage pressure and removal tests.

### 8.3 Performance, concurrency and recovery objectives

**NFR-PERF-01** · _Trace Q29_. Proposed benchmark profile uses 3,000 farmer records and 20–40 concurrent staff solely for planning until real client load is confirmed.  
**Verification:** Client approves load profile; then p95 endpoint/KPI response budgets measured and recorded.

**NFR-PERF-02** · _Trace Q48_. Scoped spatial queries shall use appropriate indexes and bounded geometry/viewport limits with observed worst-case plan analysis.  
**Verification:** Explain plans and p95 GIS query times on realistic projected land geometries.

**NFR-PERF-03** · _Trace Q29_. Custom reports and scheduled jobs shall impose query cost/row/time caps and capacity safeguards.  
**Verification:** Abuse test for expensive cross-geography filters while interactive API remains responsive.

**NFR-PERF-04** · _Trace Q22_. Concurrent resource issues shall preserve stock invariants using database-level locking, constraints and idempotency.  
**Verification:** Race test with parallel offline submissions cannot post negative/over-allocated authoritative stock.

**NFR-PERF-05** · _Trace Q45_. Proposed production backup RPO 1 hour and RTO 8 hours are contractual candidates, not guaranteed without measured restores.  
**Verification:** Offsite encrypted point-in-time restore drill with evidence of recovered transaction and elapsed time.

**NFR-PERF-06** · _Trace Q47_. Monitoring shall detect failed backup, API outage, DB saturation and sync backlog with assigned contacts and tested alerts.  
**Verification:** Synthetic alert drills with timestamps and acknowledgment.

### 8.4 Accessibility, localization and usability

**NFR-UX-01** · _Trace Q59_. First-release target is WCAG 2.2 Level AA for web views, forms and GIS with accessible alternatives to drag-only operations.  
**Verification:** Automated checks plus manual keyboard, screen reader, focus and touch testing.

**NFR-UX-02** · _Trace Q59_. Field officer interfaces shall prioritize readable high-contrast copy, large targets and sunlight legibility on approved phones.  
**Verification:** Field usability exercise with realistic outdoor conditions in both languages.

**NFR-UX-03** · _Trace Q33,Q59_. English/Sinhala language selection shall cover navigation, validation, status, accessibility names and report labels without translating entered names.  
**Verification:** Language-toggle end-to-end screenshots and native-speaker signoff.

**NFR-UX-04** · _Trace Q2,Q6_. Every queued operation shall clearly distinguish local save, pending, syncing, confirmed, rejected, conflicted, unconfirmed and expired access.  
**Verification:** Usability test confirms officer does not misinterpret saved-on-device as saved-on-server.

**NFR-UX-05** · _Trace Q60_. Documentation/training shall show role-specific offline/GIS workflows and security-limited actions with approved terminology.  
**Verification:** Designated admin/officer completes exercises after initial developer training.

### 8.5 Operations, quality and configuration management

**NFR-OPS-01** · _Trace Q42,Q43_. Deployments shall be reproducible under developer-operated accounts, with container isolation and no unmanaged personal VPS access.  
**Verification:** Fresh-server documented rehearsal with least-privileged accounts.

**NFR-OPS-02** · _Trace Q70_. Schema migration shall be versioned, repeat-safe where designed, and compatible with at least the approved maximum offline client window or managed update gate.  
**Verification:** v3→v4 vault staged update and older-client pending mutation sync tests.

**NFR-OPS-03** · _Trace Q45_. Backup data and essential decryption material shall survive production VPS destruction, with separated offsite custody.  
**Verification:** Restore to isolated environment with new VM and verified key recovery.

**NFR-OPS-04** · _Trace Q69_. Support coverage, exclusions, incident severity, response targets and client escalation shall be contractual rather than implied.  
**Verification:** Signed SLA documents and incident exercise.

**NFR-OPS-05** · _Trace Q56,Q57_. Requirements, ADRs, releases, risk exceptions and approvals shall retain version, author, decision date and evidence link.  
**Verification:** Change-control audit shows no undocumented scope change.

**NFR-OPS-06** · _Trace Q59_. New features shall not claim accessibility or security certification from CI-only pass; human acceptance evidence required.  
**Verification:** Documented manual UAT and independent security review reports.

## 9. Business rule and authority matrix (provisional pilot values)

| Rule                        | Owner proposal                                                                 | Exceptions and gates                                                   |
| --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Farmer minimal registration | Name in either language + configured geography + notice delivery + UUID/source | Optional NIC/phone; duplicate risks require review                     |
| Farmer verification         | pending-review / verified eligible for pilot enrollment; inactive denied       | Project policy version controls changes                                |
| Enrollment activation       | Immediate following server validation in pilot                                 | Per-project approval optional, configurable later                      |
| Enrollment withdrawal       | Explicit administrator-granted authority, reasons and history                  | Dynamic role policy may be reviewed for future delegates               |
| Seasonal renewal            | New enrollment in each new season                                              | Continuous projects may stay active                                    |
| Project closure             | Manual authorized with warnings                                                | No automatic closure just from end date                                |
| Offline enrollment          | 100 unresolved account/device, warn at 80; warn at 7 days, escalate at 30      | No deletion; local alert only while disconnected                       |
| Offline authoring           | Configurable hard max, proposed 7 days; idle locking                           | Browser clock tamper risk and device validation outstanding            |
| Device approval             | Individual BYOD or organization device, separate approval                      | Can't prove all physical posture via PWA; restrict offline accordingly |
| Land verification           | Provisional GPS boundary, distinct survey/official source                      | Legal survey/title never inferred                                      |
| Area quota basis            | Project-selected **validated** measurement                                     | Disputed/overlap cannot inflate benefits                               |
| Resource receipt            | Sender dispatch + receiver confirmation                                        | Partial receipt/discrepancy tracked                                    |
| Resource issue              | Approved officer allocation, offline provisional, officer confirms             | No mandatory biometric; farmer acknowledgment optional                 |
| High-risk privileges        | Two distinct approvers, no self-approval                                       | Exception only per separately approved emergency policy                |
| Access reviews              | Quarterly privileged; six-monthly ordinary; event triggers                     | Configurable; exact client approver TBD                                |
| Backup                      | Daily offsite encrypted + WAL if feasible                                      | RPO 1 hour / RTO 8 hours **targets**, not verified SLA                 |
| Hosting/maintenance         | Developer-owned VPS, recurring contract                                        | Client data control and proposed 30-day handover separate              |
| Data retention              | Configurable by category + holds                                               | No irreversible auto-deletion until legal/client approval              |

## 10. Verification and user acceptance testing

**Test status note:** These are future **required UAT/evidence cases**, not assertions of current green tests. Each release-blocking case must have a named owner, environment, test data, device model, build/commit, evidence file, pass/fail, issue reference and retest date.

### 10.1 Release-blocking end-to-end scenarios

| ID     | Scenario                                            | Pass condition                                                                                 | Trace                     |
| ------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------- |
| UAT-01 | Same-session offline farmer + dependent enrollment  | Farmer confirms first; child enrolls once; rejected parent blocks child without loss           | Q1–Q4, ADR 0021 amendment |
| UAT-02 | Officer A / B project/geography leakage             | Direct DB, API, BFF, query cache, map, reports and exports leak no B records                   | Q1, Q30, Q61              |
| UAT-03 | Server commit then lost ACK then revocation         | Client shows `unconfirmed`, no duplicate event, admin reconciliation guarded                   | Q2,Q4                     |
| UAT-04 | 100-item enrollment queue and retention             | Warn at 80; 101st refused; 7/30 day states; zero auto-deletion                                 | Q5,Q6                     |
| UAT-05 | Offline seven-day session and device-clock tamper   | Edits block at configured expiry; data preserved; limitation documented                        | Q37–Q39                   |
| UAT-06 | Lost phone and replacement                          | Server access revoked, new device independently approved, only authorized recovery             | Q39–Q41                   |
| UAT-07 | Vault forgotten passphrase recovery                 | No backdoor, only preconfigured approved recovery; no material means no guaranteed restore     | Q40                       |
| UAT-08 | GPS walking survey while fully offline              | Trace, pause/resume, correction, closure and provisional calculated area survive restart       | Q48,Q50,Q52,Q53           |
| UAT-09 | GPS foreground/background/battery matrix            | Limitations observed and recorded per browser/OS; no fabricated track on interruption          | Q53                       |
| UAT-10 | Invalid/self-intersecting polygon                   | Rejected or left provisional with actionable correction; no verified geometry                  | Q49,Q50                   |
| UAT-11 | Two overlapping parcels                             | Area of overlap shown only to authorized reviewer; provisional saved; no double quota          | Q55                       |
| UAT-12 | Recorded 2.0 acres, GPS 2.3 acres                   | Both sources retained; quota uses configured validated measure, not unapproved estimate        | Q52,Q28                   |
| UAT-13 | Two officers concurrently edit one polygon          | One accepted as versioned mutation; other flagged and preserved for review                     | Q50                       |
| UAT-14 | Offline map package with unsupported tile provider  | Download blocked; licensing evidence retained; allowed provider works offline                  | Q51                       |
| UAT-15 | Confirmed stock transfer with partial receipt       | Dispatch doesn't make stock distributable; receiver confirmation does; discrepancies recorded  | Q26                       |
| UAT-16 | Offline distribution double-spend                   | Ledger remains non-negative/authorized, duplicate submission idempotent, conflicts retained    | Q22,Q28                   |
| UAT-17 | Lot trace and compensating adjustment               | Trace batch to authorized farmer; reversal preserves original history and approvals            | Q24,Q27                   |
| UAT-18 | Scheduled sensitive export after user revocation    | Artifact retrieval denied, link expires, download audit present, no PII in logs                | Q29–Q31                   |
| UAT-19 | Excel import of duplicated/malformed farmer rows    | Preview identifies errors; approval imports valid mapping once with lineage                    | Q67                       |
| UAT-20 | RPO/RTO restore drill                               | Isolated recovery verifies DB consistency + offsite keys and records actual RPO/RTO            | Q45                       |
| UAT-21 | Protected VPS secret rotation cron                  | Recovery/active sessions remain coherent; key rotation logs no secrets; no data loss           | Q46                       |
| UAT-22 | Privileged grant dual approval and temporary expiry | Unapproved/self-grant denied, two-person high-risk grant works, expiry works                   | Q61–Q66                   |
| UAT-23 | Staff transfer with old device offline              | New server reads denied; offline limits clearly disclosed; audit retains historic actor        | Q64                       |
| UAT-24 | WCAG 2.2 AA on maps and forms                       | Keyboard/non-drag alternatives, contrast, screen reader/language and mobile touch verified     | Q59                       |
| UAT-25 | Full approved pilot deployment and rollback         | Release gate and restoration drill protect both DB and unsynced offline work                   | Q58,Q68,Q70               |
| UAT-26 | Planning source 2,700 vs 2,760                      | Import/report baseline blocked pending signed client correction                                | Q56                       |
| UAT-27 | English/Sinhala role-specific training              | Trained users complete representative forms, GPS survey and sync in both locales               | Q59,Q60                   |
| UAT-28 | Contract exit and data handover                     | Authorized complete structured export, recipient identity/review, deletion/hold decision trace | Q44                       |

### 10.2 Component and adversarial testing

Testers shall maintain feature-level unit/integration coverage for validation, versioned native PostgreSQL migrations, FORCED RLS, idempotency journal, signed actor context, CSRF/session revocation, direct restricted-role SQL, offline account/device partition swaps, Dexie schema migration, authenticated archive tamper, multi-tab Web Lock, cryptographic recovery and backup restoration. Functional tests do not replace real-device usability tests or independent security assurance.

### 10.3 Severity and sign-off criteria

- **Critical (release blocker):** unauthorized disclosure, cross-scope data access, lost authoritative records, false stock confirmation, accepted invalid verification, bypassable approval, irrecoverable migration corruption, active exploit in cryptographic design.
- **High (release blocker for affected workflow):** dependable offline survey fails on an approved target device; boundary overwrite; encrypted key/backup mismatch; critical report mismatch; unreviewed insecure tile license.
- **Medium/low:** explicit documented remediation, owner, deadline and written client risk acceptance; no sign-off if an unmitigated defect prevents an essential agreed workflow.
- **Evidence:** signed acceptance matrix for each approved module; UAT testers must use defined synthetic/consented records, approved hardware and real field conditions; production release gate distinct from code merge gate.

## 11. High-risk capability feasibility and security assessment (summary)

| Capability                            | Initial feasibility                                                                                      | Major limitation                                                                                                                                 | Required proof / release gate                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline GPS perimeter tracking        | **Conditionally feasible** for foreground visible PWA sessions on supported devices                      | Geolocation updates are not guaranteed when document is hidden, device locks or OS suspends browser; accuracy cannot equal official survey       | Real-device field circuit, interruption/recovery, user-accessibility and accuracy reference comparison; native alternative decision if uninterrupted background tracking required |
| GIS calculated area                   | **Feasible for estimated spatial analytics** using PostGIS geodesic area; not legal proof                | Reported GPS horizontal accuracy, multipath, gaps, drawn fixes, overlapping rights; no universal percent tolerance                               | Client-approved positional/area accuracy criteria and accepted official reference dataset; geometry and discrepancy UAT                                                           |
| Offline vault encryption and recovery | **Feasible with independent crypto design**, exact recovery mechanism not yet approved                   | Browser does not guarantee hardware-backed key, device security attestation or recoverability after losing both passphrase and recovery material | Threat model, key lifecycle, escrow authorization, cross-device policy, cryptographic test vectors and independent review                                                         |
| Seven-day offline access              | **Conditionally feasible as best-effort policy**, not guaranteed secure against compromised device/clock | Browser clock manipulation, offline revocation latency and previously decrypted data                                                             | Actual supported-device test matrix and honest residual-risk acceptance                                                                                                           |
| Offline dependent enrollment          | **Design change needed; NOT authorized now**                                                             | ADR 0021 existing confirmed-farmer restriction and required independent gates                                                                    | Rewritten ADR dependency ordering, queue error classes, independent security review, A1–A4 and Gate E                                                                             |
| Offline inventory                     | **Feasible as provisional intents**, no offline authority to finalize stock                              | Competing disconnected requests, duplicate/overquota and stock availability uncertainty                                                          | Preallocation, constrained authoritative ledger and race/retry/reconciliation tests                                                                                               |
| Licensed offline maps                 | **Provider-dependent**                                                                                   | Public OpenStreetMap standard tile service prohibits prefetch/offline packages                                                                   | Written license/provider approval, attribution and tile-access/storage tests                                                                                                      |
| VPS cron secret rotation              | **Selectively feasible** for supported credentials                                                       | Blind rotation of token-signing, encryption/decryption or DB passwords can invalidate active services/backups                                    | Per-secret rotation matrix, staging rehearsal, rollback and key version retention                                                                                                 |

Formal threat/risk analysis, architecture sequence, safeguards and test protocol appear in companion **AOP-ARCH-001**.

## 12. Exclusions, unresolved client decisions and approval gates

### 12.1 Scope exclusions, not silent reductions

Farmer self-service is Phase 2. Procurement/transport, loans, financial settlement, insurance and legally binding cadastral certification remain outside the proposed first release until separately contracted. Full GIS, comprehensive reporting, offline walking survey and inventory ledger are _within_ the owner-proposed first release even though older source drafts deferred them. Removing them requires documented change request and signed client acceptance.

### 12.2 Blocking unknowns

1. **Legal and data governance:** registered client organization, named owner/processor parties, required contracts, applicable legal basis and the authoritative final Sinhala/English notice; PDPA legal timeline should be verified by counsel (official DPA gazette 2498/16 schedules key provisions for 1 January 2027).
2. **Domain:** exact farmer/status/stock quotas, reviewer authority, source data 2,700 vs 2,760, GIS survey legal hierarchy, area difference thresholds, overlap tolerance and approved land evidence.
3. **People and permissions:** named approvers, project/region/role matrix, staffing, actual devices, MFA factors, device BYOD management and revocation realities.
4. **Security:** client and independent security approvals; ADR 0021 conditions; offline recovery/key custody; real-device persistence and GPS background feasibility.
5. **Maps and service:** licensed offline tile source, coverage, storage size, cost; production domain/region and verified TLS; encrypted offsite retention and 1h/8h recovery proof.
6. **Commercial and UAT:** agreed scope, detailed estimate/quotation, dates, owner-run hosting and maintenance SLA, 30-day exit and initial training quantities; named users/UAT criteria.

### 12.3 Explicit ADR 0021 safety gate

The current GitHub ADR reads **NOT Accepted**. Its A1 client approval, A2 independent design security review, A3 prerequisite ENR-AUTH/ENR-AUDIT designs, A4 explicit reviewed owner ADR status change, staged OFF-04A–D and later separate enablement Gate E remain in force. Q3 additionally requires reviewed amendment for dependent unsynced farmer creation. Do not grant field-officer enrollment authority or enable offline enrollment for real officers solely from this SRS.

### 12.4 Contract and release sign-off template

| Name/role                           | Decision                                           | Date | Evidence/version | Signature |
| ----------------------------------- | -------------------------------------------------- | ---- | ---------------- | --------- |
| Client sponsor (TBD)                | Approve/revise SRS scope, budget and exclusions    | TBD  | TBD              | TBD       |
| Operations/GIS representative (TBD) | Confirm field, stock and GIS verification rules    | TBD  | TBD              | TBD       |
| Privacy/legal reviewer (TBD)        | Approve purpose, notice, retention and data rights | TBD  | TBD              | TBD       |
| Independent security reviewer (TBD) | Approve high-risk design and acceptance evidence   | TBD  | TBD              | TBD       |
| Developer architecture lead (TBD)   | Record technical ADRs and implementation readiness | TBD  | TBD              | TBD       |

No signature is inferred from discussion or generated documents.

## Appendix A. Q1–Q71 owner decision-to-requirement trace

The summary text below follows the consolidated owner register; exact row IDs are linked through `Trace: Qn` on the FR/NFR statements above. All source answers remain provisional.

|   Q | Selected | Proposal summary                                                                                        | Functional and non-functional coverage                     |
| --: | :------: | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
|   1 |    A     | Allow field-officer enrollment only through explicit enrollment.create and current intersecting proj…   | FR-PROJ-012                                                |
|   2 |    A     | Allow encrypted offline enrollment intents with automatic sync on restored valid connection/session…    | FR-PROJ-013, FR-OFF-007, FR-OFF-011, NFR-OFF-02 (+more)    |
|   3 |    A     | Allow enrollment intent for a farmer newly registered offline during the same session.                  | FR-PROJ-014, FR-PROJ-015, FR-OFF-008, NFR-OFF-02           |
|   4 |    B     | Show safe actionable enrollment refusal reasons only to currently authorized field officers.            | FR-PROJ-016, FR-OFF-012                                    |
|   5 |    B     | Cap unresolved offline enrollment intents at 100 per account/device, warning at 80.                     | FR-PROJ-017, FR-OFF-013                                    |
|   6 |    A     | Warn at 7 days unresolved; flag and escalate at 30 days.                                                | FR-PROJ-018, FR-OFF-011, FR-OFF-013, NFR-UX-04             |
|   7 |    A     | Default pilot enrollment withdrawal authority to administrators with explicit enrollment.withdraw.      | FR-ORG-015, FR-PROJ-019                                    |
|   8 |    C     | Make per-enrollment approval configurable by project; pilot defaults to immediate activation after s…   | FR-PROJ-006                                                |
|   9 |    A     | Allow one farmer to be enrolled in several projects simultaneously when eligible.                       | FR-PROJ-001, FR-PROJ-002                                   |
|  10 |    B     | Support both continuous projects and seasonal projects with configured cycles and dates.                | FR-PROJ-003                                                |
|  11 |    C     | Configure renewal by project; default new enrollment for every new seasonal cycle and ongoing enroll…   | FR-PROJ-004                                                |
|  12 |    C     | Configure project/cycle closure; pilot uses manual authorized closure with end-date warnings.           | FR-PROJ-005                                                |
|  13 |    C     | Make official enrollment effective date policy configurable; pilot uses server confirmation time.       | FR-PROJ-007                                                |
|  14 |    C     | Configure farmer verification prerequisites per project; pilot allows pending-review and verified fa…   | FR-PROJ-008, FR-PROJ-020                                   |
|  15 |    C     | Configure re-enrollment per project; pilot permits immediate new enrollment after eligibility restored. | FR-PROJ-002                                                |
|  16 |    B     | If an enrolled farmer later becomes inactive/ineligible, flag enrollment for review rather than auto…   | FR-PROJ-009, FR-PROJ-020                                   |
|  17 |    B     | When farmer geography changes, retain enrollment and recompute access/coverage, flag exceptions.        | FR-ORG-004, FR-FARM-005, FR-FARM-006, FR-PROJ-010          |
|  18 |    C     | Store farmer registration geography separately from each parcel geography.                              | FR-ORG-001, FR-ORG-004, FR-FARM-011, FR-LAND-001 (+more)   |
|  19 |    C     | Support multiple people and configurable owner/tenant/cultivator/manager relationships per land parcel. | FR-FARM-011, FR-LAND-002                                   |
|  20 |    C     | Configure evidence/documents by project and relationship type.                                          | FR-LAND-003, FR-DATA-004                                   |
|  21 |    C     | Use configurable agricultural resource catalog and an authoritative auditable stock ledger.             | FR-INV-001, FR-INV-002, FR-INV-015                         |
|  22 |    C     | Allow authorized officers to distribute from preallocated stock offline.                                | FR-INV-003, FR-INV-012, FR-OFF-007, FR-OFF-010 (+more)     |
|  23 |    C     | Configure farmer acknowledgment by project/resource.                                                    | FR-INV-004                                                 |
|  24 |    C     | Record loss, damage, returns and corrections as separate audited transactions.                          | FR-INV-005, FR-INV-013                                     |
|  25 |    C     | Use resource-specific base units and validated conversions.                                             | FR-INV-006, FR-INV-007                                     |
|  26 |    B     | Require sender and receiver confirmation for inter-location stock transfers.                            | FR-INV-008, FR-INV-014                                     |
|  27 |    C     | Enable batch/lot traceability by resource configuration.                                                | FR-INV-009                                                 |
|  28 |    C     | Configure distribution quotas by project/resource/cycle/farmer category/validated area.                 | FR-INV-010, FR-INV-011, FR-OFF-010                         |
|  29 |    B     | Deliver comprehensive reporting and analytics in first release.                                         | FR-RPT-001, FR-RPT-002, FR-RPT-003, FR-RPT-007 (+more)     |
|  30 |    C     | Use separate dynamic permissions for dashboards, report viewing, exports and scheduling.                | FR-RPT-004, FR-RPT-012                                     |
|  31 |    C     | Configure report delivery via dashboard, notifications and authenticated download links.                | FR-RPT-005, FR-RPT-006                                     |
|  32 |    C     | Retain a minimal core farmer profile and add versioned, approved project-specific forms.                | FR-FARM-001, FR-FARM-002, FR-FARM-003, FR-FARM-007 (+more) |
|  33 |    C     | Use versioned Sinhala/English privacy notices, recording verbal delivery as applicable.                 | FR-FARM-007, FR-FARM-008, FR-DATA-001, NFR-SEC-06 (+more)  |
|  34 |    C     | Set category-specific configurable retention and archive/anonymize/delete/legal hold rules.             | FR-FARM-012, FR-DATA-002, NFR-SEC-06                       |
|  35 |    C     | Apply field-level RBAC+ABAC, default masking and purpose/scope control to sensitive data.               | FR-FARM-002, FR-FARM-009, FR-RPT-006, FR-DATA-003 (+more)  |
|  36 |    C     | Offline store limited to separately authorized, encrypted minimum dataset on approved devices.          | FR-OFF-001, NFR-SEC-03                                     |
|  37 |    C     | Permit both personal and organization devices after individual approval and minimum security checks.    | FR-OFF-002, FR-OFF-014, NFR-SEC-08                         |
|  38 |    C     | Configurable maximum offline access duration with hard limit; pilot default 7 days.                     | FR-OFF-003, FR-OFF-004, NFR-OFF-01                         |
|  39 |    C     | Lost device: revoke server access; approve fresh replacement; recover from authorized encrypted back…   | FR-OFF-005, FR-OFF-014, FR-OFF-016, NFR-OFF-03             |
|  40 |    C     | Design optional preconfigured encrypted vault recovery-key mechanism with controlled approval.          | FR-OFF-006, FR-OFF-016, NFR-SEC-05                         |
|  41 |    B     | Make device access administration permission-based: device.view, device.approve, device.revoke.         | FR-ORG-014, NFR-SEC-08                                     |
|  42 |    C     | Use phased cost-conscious hosting: VPS + Docker, encrypted offsite backups, monitoring and tested re…   | FR-OPS-001, NFR-OPS-01                                     |
|  43 |    B     | Developer/software company owns and operates production hosting infrastructure and bills client.        | FR-OPS-002, NFR-OPS-01                                     |
|  44 |    C     | Client retains control/ownership of business data; developer retains separately agreed software IP.     | FR-DATA-006, FR-DATA-007                                   |
|  45 |    C     | Daily encrypted offsite backups plus WAL archiving or equivalent where feasible.                        | FR-OPS-003, NFR-PERF-05, NFR-OPS-03                        |
|  46 |    A     | Store production secrets in protected VPS environment files, outside Git.                               | FR-OPS-004, NFR-SEC-04                                     |
|  47 |    C     | Layered monitoring of VPS, API, database, backup and offline synchronization.                           | FR-OPS-005, NFR-SEC-07, NFR-PERF-06                        |
|  48 |    B     | Deliver full GIS from the first release: interactive maps, boundaries/polygon tools, area measuremen…   | FR-LAND-004, FR-LAND-005, FR-LAND-019, NFR-PERF-02         |
|  49 |    C     | Support GPS-drawn, digitized and official survey boundary sources with provenance/accuracy/verificat…   | FR-LAND-006, FR-LAND-007, FR-LAND-020                      |
|  50 |    C     | Allow encrypted offline GPS and polygon creation/editing with version control and conflict review.      | FR-LAND-013, FR-LAND-014, FR-OFF-007, FR-OFF-009 (+more)   |
|  51 |    C     | Provider-independent GIS using open-source frontend, PostGIS and licensed offline map packages.         | FR-LAND-018, FR-RPT-011, NFR-OFF-05                        |
|  52 |    C     | Keep separately sourced recorded, surveyed and GIS areas; configurable per-project authoritative val…   | FR-LAND-008, FR-LAND-009, FR-LAND-010, FR-LAND-020 (+more) |
|  53 |    C     | Smart walk-the-boundary GPS tracking with pause/resume, accuracy indicators, suspicious-jump warning…   | FR-LAND-010, FR-LAND-011, FR-LAND-012, NFR-OFF-04          |
|  54 |    C     | Keep final polygon and survey metadata; raw GPS route only for configured, purpose-limited evidence…    | FR-LAND-017, FR-DATA-005                                   |
|  55 |    C     | Detect parcel overlaps with PostGIS and flag measured overlap for authorized review.                    | FR-LAND-015, FR-LAND-016, FR-RPT-008                       |
|  56 |    C     | Maintain requirements traceability, source versions and a conflict-resolution register.                 | FR-RPT-010, FR-DATA-010, NFR-OPS-05                        |
|  57 |    C     | Use formal change control with technical, budget, schedule, security and dependency impact assessment.  | FR-DATA-011, NFR-OPS-05                                    |
|  58 |    C     | Structured UAT with traceable acceptance cases, real client users and pilot field workflows.            | FR-OPS-006                                                 |
|  59 |    B     | Target WCAG 2.2 Level AA in the first release.                                                          | FR-OPS-007, NFR-UX-01, NFR-UX-02, NFR-UX-03 (+more)        |
|  60 |    A     | Developer-led initial role-based training and basic user documentation.                                 | FR-OPS-008, NFR-UX-05                                      |
|  61 |    C     | Delegated dynamic RBAC management using explicit role/permission/user-grant capabilities.               | FR-ORG-001, FR-ORG-002, FR-ORG-003, FR-ORG-004 (+more)     |
|  62 |    C     | Risk-based approval: routine grants by authorized admin, high-risk grants require two distinct appro…   | FR-ORG-006, FR-ORG-007, FR-ORG-008, FR-ORG-009             |
|  63 |    C     | Time-limited scoped grants with automatic expiry and controlled emergency elevation.                    | FR-ORG-010                                                 |
|  64 |    C     | Centralize user lifecycle and retain one staff identity across transfers.                               | FR-ORG-003, FR-ORG-011, FR-FARM-006                        |
|  65 |    C     | Risk-based periodic access reviews; pilot privileged quarterly and ordinary every six months.           | FR-ORG-012                                                 |
|  66 |    C     | Risk-based MFA: mandatory for privileged accounts; step-up for high-risk operations.                    | FR-ORG-013, NFR-SEC-02                                     |
|  67 |    C     | Controlled Excel/CSV legacy-data migration with field mapping, preview and deduplication.               | FR-FARM-004, FR-FARM-010, FR-DATA-008, FR-DATA-009         |
|  68 |    C     | Controlled pilot rollout of complete approved first-release feature set with measurable gates.          | FR-OPS-009                                                 |
|  69 |    C     | Recurring developer-operated hosting/maintenance contract with scoped support and severity-based res…   | FR-OPS-010, NFR-OPS-04                                     |
|  70 |    C     | Controlled CI/CD with staging, tests, approval, versioned migration and verified backups.               | FR-OFF-015, FR-OPS-011, NFR-OPS-02                         |
|  71 |    C     | Consolidate decisions, assess scope/cost/schedule/risk, and require written client approval of basel…   | FR-DATA-012, FR-OPS-012                                    |

## Appendix B. Source inventory and external technical standards

**Conversation and working project files**

- 71-item provisional owner decision register, 16 November 2026; questions 1–36 summarized from earlier discussion, questions 37–71 preserved in current sequence. For formal client sign-off, validate original transcripts/decision evidence.
- 14 November master source package: `01_Requirements_Business/REQUIREMENTS_BASELINE_v1.md`; `02_Database_Architecture/CURRENT_V2_1_REVIEW/Architecture_V2_1.md`; `03_Frontend_UI_UX/CURRENT_Bilingual_Visual_Decisions/UX_Decision_Handoff.md` (working drafts, not signed contract).
- GitHub `docs/requirements/OPEN_DECISIONS.md`, `docs/requirements/MASTER_PACKAGE_REVIEW.md`, `docs/PROJECT_CONTEXT.md`, accepted `docs/architecture/decisions/ADR-data-state-cache.md`; ADRs 0004, 0006, 0007, 0008, 0011, 0015, 0018–0021; `docs/development/PHASE_1_STATUS.md`, `ROADMAP.md`, `PROJECT_HANDOVER.md`. Accessed 16 November 2026.
- Step 2 report `AGRI_GITHUB_RECONCILIATION.md`, 22 conflict/impact findings, prepared outside GitHub.

**Technical and legal sources (verification references, not automatic contractual obligations)**

1. W3C Geolocation Candidate Recommendation Draft, 5 Nov 2026 — https://www.w3.org/TR/geolocation/ — visible-document delivery and unguaranteed GPS accuracy.
2. MDN Geolocation `watchPosition()` — https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition — HTTPS, permission and API behavior.
3. PostGIS `ST_Area` — https://www.postgis.net/docs/ST_Area.html — spheroidal geography area calculation in square meters.
4. W3C WCAG 2.2 — https://www.w3.org/TR/WCAG22/ — target Level AA.
5. OWASP ASVS 5.0.0 — https://asvs.owasp.org/ — security assessment reference.
6. OSM Foundation Tile Usage Policy — https://operations.osmfoundation.org/policies/tiles/ — standard tiles cannot be bulk prefetched for offline packages.
7. Sri Lanka Data Protection Authority (2026 legislative updates/2025 amendment) — https://www.dpa.gov.lk/guidelines and https://www.dpa.gov.lk/privacy-notice — obtain current legal advice before processing real data.

**Document end — draft for review, not approved implementation authorization.**
