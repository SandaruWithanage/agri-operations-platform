# Implementation traceability to SRS v0.9 (working draft, 17 Nov 2026)

**Status: developer-side working record, not an approval and not a completion measure.** It maps the requirement IDs of the imported [SRS v0.9](review-package-v0.9/AOP_SRS_v0.9_REVIEW.md) (itself NOT CLIENT APPROVED) to what exists in the repository. Statuses come from the delivered feature set and its documentation, **not** from a requirement-by-requirement test review, and every status excludes independent security review (Gate G1), device testing and client acceptance. Where evidence is missing the status is "Not started", never a guess in the other direction.

Per [AGENTS.md](../../AGENTS.md) no completion percentage is derived from this table: requirements differ enormously in size, and the counts below are an inventory, not progress.

## Status meanings

| Status                | Meaning                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Implemented (bounded) | Built, tested with synthetic data, and enforced where the requirement says so, within the stated limits |
| Partial               | A bounded online slice exists; the evidence column says what is missing                                 |
| Design only           | An ADR or proposal exists; no code; usually waiting on a decision or review                             |
| Blocked               | Cannot start until a recorded approval (for example ADR 0021 acceptance)                                |
| Not started           | No implementation or design                                                                             |

## Inventory (not progress): 164 requirements

- Implemented (bounded): 8
- Partial: 47
- Design only: 17
- Blocked: 5
- Not started: 87

## Organization, access and devices (FR-ORG)

| ID         | Requirement (shortened)                                                                           | Status                | Evidence or gap                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| FR-ORG-001 | The system shall register one initial managing organization while keeping organization identity … | Not started           | No implementation or design yet                                                                                     |
| FR-ORG-002 | The system shall maintain configurable hierarchical organizational units, positions, coverage ar… | Not started           | No implementation or design yet                                                                                     |
| FR-ORG-003 | The system shall distinguish a person, login account, staff position, farmer business identity a… | Not started           | No implementation or design yet                                                                                     |
| FR-ORG-004 | Organizational hierarchy and administrative geography shall be separate; rights shall reflect cu… | Not started           | No implementation or design yet                                                                                     |
| FR-ORG-005 | Authorized administrators shall manage organization, project and geography scopes through guarde… | Not started           | No implementation or design yet                                                                                     |
| FR-ORG-006 | Each business operation shall require an explicit action permission evaluated against actor, res… | Implemented (bounded) | `authz.allowed`, project and organization predicates, FORCE RLS, signed actor context; `docs/security/ABAC_GATE.md` |
| FR-ORG-007 | Scope sets shall apply all clauses conjunctively; alternative grants may be considered disjuncti… | Partial               | Organization, project and geography clauses intersect today; no scope-set administration                            |
| FR-ORG-008 | Role/grant administration shall be database-configurable using `role.create`, `role.update`, `pe… | Design only           | ADR 0022 (roles as data); needs DEC-02 and independent review                                                       |
| FR-ORG-009 | High-risk grants shall require two distinct authorized approvers, no requester self-approval, an… | Design only           | ADR 0022 (two distinct approvers); not implemented                                                                  |
| FR-ORG-010 | Temporary grants shall have validity windows, justification, automatic expiry and audited approv… | Not started           | No implementation or design yet                                                                                     |
| FR-ORG-011 | Transfer, suspension, departure and reassignment shall recalculate authorization, revoke impacte… | Not started           | No implementation or design yet                                                                                     |
| FR-ORG-012 | System shall schedule configurable risk-based access reviews: proposed quarterly for privileged,… | Not started           | No implementation or design yet                                                                                     |
| FR-ORG-013 | Privileged accounts shall use MFA, others risk-based MFA; high-risk operations shall require fre… | Partial               | MFA is required for every staff account (stricter than risk-based); no step-up for high-risk operations             |
| FR-ORG-014 | Device administration shall be separately granted through `device.view`, `device.approve`, `devi… | Partial               | Operator tooling for device approval (`DEVICE_ENROLLMENT.md`); no device permissions or admin UI                    |
| FR-ORG-015 | Enrollment withdrawal shall require separate `enrollment.withdraw`, provisionally administrator-… | Implemented (bounded) | ENR-AUTH-01: administrator-only withdrawal enforced in PostgreSQL (PR #43)                                          |

## Farmers (FR-FARM)

| ID          | Requirement (shortened)                                                                           | Status      | Evidence or gap                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-FARM-001 | Create a farmer business identity with stable server/client UUID, name in at least one supported… | Partial     | Online and offline-draft farmer registration with UUID, geography, creator, source and time; language and name rules not fully verified against this text |
| FR-FARM-002 | Identity numbers, contacts, bank details and other sensitive attributes shall be optional separa… | Not started | No implementation or design yet                                                                                                                           |
| FR-FARM-003 | Project-specific farmer forms shall use versioned templates, conditional required fields only af… | Not started | No implementation or design yet                                                                                                                           |
| FR-FARM-004 | System shall support candidate duplicate detection, review and linking without silent merging of… | Partial     | Duplicate-risk flag and review queue; no linking or merge workflow                                                                                        |
| FR-FARM-005 | Farmers shall support pending-review, verified, inactive and other approved status transitions w… | Partial     | Pending-review, verification and corrections with versions (`FARMER_VERIFICATION.md`); inactive/retired transitions not done                              |
| FR-FARM-006 | Farmer geography corrections shall change visibility and assignment-based access atomically with… | Partial     | Geography correction editor with scope recalculation (`FARMER_CORRECTION_EDITOR.md`)                                                                      |
| FR-FARM-007 | Registration shall record delivery of the current approved bilingual privacy notice, including a… | Partial     | A notice-provided flag is recorded; versioned bilingual notice text and authorship are not                                                                |
| FR-FARM-008 | Additional purpose-specific consent shall be tracked separately where approved legal basis/polic… | Not started | No implementation or design yet                                                                                                                           |
| FR-FARM-009 | Sensitive identity reads shall be masked by default and require explicit purpose/scope-bound gra… | Not started | No implementation or design yet                                                                                                                           |
| FR-FARM-010 | The system shall preserve original registration sources and migration lineage for imported farme… | Not started | No implementation or design yet                                                                                                                           |
| FR-FARM-011 | Farmer residence/registration geography shall not be assumed to equal parcel geography, cultivat… | Not started | No implementation or design yet                                                                                                                           |
| FR-FARM-012 | Retired/inactive farmer records shall obey approved retention, legal holds and pseudonymization/… | Not started | No implementation or design yet                                                                                                                           |

## Projects and enrollment (FR-PROJ)

| ID          | Requirement (shortened)                                                                           | Status                | Evidence or gap                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| FR-PROJ-001 | Farmers may have more than one current enrollment across projects where separately eligible.      | Implemented (bounded) | Enrollments are per project; a farmer can be enrolled in several (`PROJECT_ENROLLMENT.md`)                          |
| FR-PROJ-002 | Duplicate current enrollment within the same project/cycle policy shall be rejected, while new r… | Partial               | One current enrollment per project is enforced; cycles and re-enrollment history are not                            |
| FR-PROJ-003 | Projects shall be configurable as continuous or seasonal, with separately versioned cycles, star… | Not started           | No implementation or design yet                                                                                     |
| FR-PROJ-004 | Renewal policy shall be per project; proposed pilot seasonal cycles require a new enrollment and… | Not started           | No implementation or design yet                                                                                     |
| FR-PROJ-005 | Project/cycle closure shall be manual by authorized users in pilot, with configurable closure po… | Not started           | No implementation or design yet                                                                                     |
| FR-PROJ-006 | Per-project approval mode shall be versioned; pilot activation after validation, with configurab… | Not started           | No implementation or design yet                                                                                     |
| FR-PROJ-007 | Enrollment shall record observed field-event time, server receipt/confirmation time and configur… | Not started           | No implementation or design yet                                                                                     |
| FR-PROJ-008 | Per-project prerequisites shall configure eligible farmer statuses; proposed pilot allows pendin… | Partial               | Per-project enrollment policy with eligible farmer statuses (ADR 0020)                                              |
| FR-PROJ-009 | If enrolled farmer becomes ineligible/inactive, flag current enrollment for review without auto-… | Not started           | No implementation or design yet                                                                                     |
| FR-PROJ-010 | Farmer geography changes shall trigger scope recalculation and coverage exceptions without autom… | Not started           | No implementation or design yet                                                                                     |
| FR-PROJ-011 | Each project shall define whether eligibility geography follows farmer registration or a linked … | Not started           | No implementation or design yet                                                                                     |
| FR-PROJ-012 | `enrollment.create` shall require current session, permission, project assignment, geography int… | Implemented (bounded) | `enrollment.create` checks session, permission, project assignment and geography intersection (migration 22 onward) |
| FR-PROJ-013 | Authorized officers may queue enrollment intents offline and synchronize them automatically afte… | Blocked               | Offline enrollment: ADR 0021 is not accepted; implementation not authorized                                         |
| FR-PROJ-014 | An officer may create an offline enrollment dependent on a newly queued farmer registration in t… | Design only           | ADR 0021 draft amendment A (same-session dependency); not accepted                                                  |
| FR-PROJ-015 | A rejected/conflicted farmer registration shall prevent dependent enrollment submission and show… | Design only           | ADR 0021 draft amendment A (`blocked-dependency`); not accepted                                                     |
| FR-PROJ-016 | Refusal responses shall show authorized officers safe actionable reason categories without revea… | Design only           | ADR 0021 section 11 refusal-reason options; owner decision pending                                                  |
| FR-PROJ-017 | Queue shall cap unresolved enrollment intents at 100/account/device with warning at 80; never de… | Blocked               | Queue caps: ADR 0021 not accepted                                                                                   |
| FR-PROJ-018 | Unresolved enrollment queue entries shall warn at seven days and escalate at 30 days, without ag… | Blocked               | Queue ageing: ADR 0021 not accepted                                                                                 |
| FR-PROJ-019 | Enrollment withdrawal shall be an explicit audited state transition with reasons and separate pr… | Implemented (bounded) | Explicit audited withdrawal state transition, administrator only (PR #43)                                           |
| FR-PROJ-020 | Project benefit allocation shall recheck current farmer/project/cycle status and any hold, not e… | Not started           | No implementation or design yet                                                                                     |

## Land and GIS (FR-LAND)

| ID          | Requirement (shortened)                                                                           | Status      | Evidence or gap                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| FR-LAND-001 | Each land parcel shall have identity, separately configured administrative geography, creator/ti… | Partial     | Land identification with geography, creator and source (ADR 0011); parcel-person relations absent                                   |
| FR-LAND-002 | Parcel-person relationships shall include configurable owner, tenant, cultivator, manager and ot… | Not started | No implementation or design yet                                                                                                     |
| FR-LAND-003 | Required land evidence shall be configurable by project/relationship; basic land intake shall re… | Not started | No implementation or design yet                                                                                                     |
| FR-LAND-004 | First-release GIS shall render scope-filtered interactive basemaps, farmer/parcel pins, polygon … | Partial     | Authorized viewport endpoints for polygons and points (PR #50); no map UI, provider or layers                                       |
| FR-LAND-005 | Authorized users shall draw, edit and import parcel boundary polygons with validation, history a… | Partial     | Polygon recording through the walk survey (online); no draw, edit or import UI                                                      |
| FR-LAND-006 | Boundary versions shall track GPS, digitized and official-survey sources, accuracy, recorded/sur… | Partial     | GPS and digitized sources, accuracy, version history; `official_survey` is not accepted from clients                                |
| FR-LAND-007 | Boundary states shall support provisional, review, verified, disputed and superseded outcomes, w… | Partial     | Provisional and superseded only; review, verified and disputed states not built                                                     |
| FR-LAND-008 | Store reported, legally surveyed and GIS-calculated areas separately, with original unit, source… | Partial     | Reported area and calculated geodesic area are stored separately; surveyed area and original unit are not                           |
| FR-LAND-009 | Configurable project policy shall select which validated area is authoritative for eligibility a… | Not started | No implementation or design yet                                                                                                     |
| FR-LAND-010 | Field officers shall be able to initiate a walk-the-boundary session that samples GPS as they wa… | Partial     | Walk-the-boundary engine, screen and online route (PRs #52, #54, #55); no phone trials                                              |
| FR-LAND-011 | Tracking shall support explicit start/stop/pause/resume, display accuracy, and warn about stale … | Partial     | Start, pause, resume, accuracy gating, jump and gap warnings; background GPS limits untested on devices                             |
| FR-LAND-012 | Officer shall be able to review and manually correct GPS points/segments without destroying the … | Partial     | Point removal and jump acceptance with a reason and an audit event; gap markers and manual fill are not done (alignment note GA-04) |
| FR-LAND-013 | Authorized offline boundary capture/edit shall write encrypted local survey drafts and queued ge… | Design only | ADR 0025 (proposed): encrypted survey drafts in the existing vault; needs crypto review; not implemented                            |
| FR-LAND-014 | The server shall validate polygon geometry, area, tenant/org boundary, current permissions, expe… | Partial     | Server validates ring, validity, area, permissions and expected version in `land.record_geometry` (migration 25)                    |
| FR-LAND-015 | Overlap detection shall calculate candidate overlap area and affected parcel identities only wit… | Design only | ADR 0024 (global detection, scope-limited disclosure); owner decision pending                                                       |
| FR-LAND-016 | Overlapping parcels may be saved provisionally but conflicted portions shall not become verified… | Design only | ADR 0024 (conflicted portion excluded from allocatable area); not implemented                                                       |
| FR-LAND-017 | Raw GPS tracks shall be purpose-limited survey evidence, stored only per configured retention an… | Not started | No implementation or design yet                                                                                                     |
| FR-LAND-018 | Map provider configuration shall be replaceable; offline basemap downloads require a documented … | Design only | ADR 0023 (replaceable provider adapter); not accepted, no provider chosen                                                           |
| FR-LAND-019 | GIS shall support spatial filtering, area summaries, overlap and coverage analysis with scope-aw… | Partial     | Viewport reads are scope-limited and bounded; no area summaries, overlap or coverage analysis                                       |
| FR-LAND-020 | GIS area and GPS confidence shall be represented as estimates unless verified survey status supp… | Partial     | Polygons are labelled provisional identification only and are never styled as verified; acres, hectares and m² shown                |

## Offline and sync (FR-OFF)

| ID         | Requirement (shortened)                                                                           | Status      | Evidence or gap                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| FR-OFF-001 | Device offline vault shall store only separately authorized minimum data and exclude NIC, financ… | Partial     | Encrypted vault holds farmer registration drafts only (`OFFLINE_WORKSPACE.md`)                          |
| FR-OFF-002 | Both BYOD and organization devices may be individually approved subject to minimum security chec… | Partial     | Approved-device model with operator tooling (`DEVICE_ENROLLMENT.md`)                                    |
| FR-OFF-003 | Offline authoring shall have configurable policy-bound maximum, proposed pilot seven days since … | Partial     | Offline window is configurable but defaults to one hour; the 7-day proposal is an open conflict (SC-04) |
| FR-OFF-004 | Offline vault shall use local unlock and inactivity locking independently of server login; sync … | Partial     | Local vault unlock and inactivity behavior for farmer drafts; see `OFFLINE_WORKSPACE.md`                |
| FR-OFF-005 | Lost device shall trigger server session/device revocation, audited replacement approval and enc… | Not started | No implementation or design yet                                                                         |
| FR-OFF-006 | Optional vault recovery-key mechanism shall be preconfigured, encryption-preserving, controlled … | Not started | No implementation or design yet                                                                         |
| FR-OFF-007 | Farmer, dependent enrollment, authorized distribution and GIS mutations shall use one durable pe… | Blocked     | One durable queue for enrollment and GIS: ADR 0021 and an offline GIS design are not accepted           |
| FR-OFF-008 | Offline dependency graph shall topologically order farmer creation before dependent enrollment a… | Blocked     | Dependency ordering: ADR 0021 not accepted                                                              |
| FR-OFF-009 | Offline GIS edits shall use expected geometry version and conflict queues rather than last-write… | Design only | Offline GIS conflict handling not designed beyond ADR 0023 principles                                   |
| FR-OFF-010 | Offline distribution may not create authoritative inventory balance until server validates alloc… | Not started | No implementation or design yet                                                                         |
| FR-OFF-011 | Sync shall support automatic reconnect retry with bounded backoff, manual Sync Now and durable s… | Partial     | Retry and sync for farmer drafts (`FIELD_SESSION_SYNC.md`)                                              |
| FR-OFF-012 | Offline synchronization shall distinguish authentication failure, authorization denial, business… | Partial     | Sync distinguishes authentication, authorization and conflict outcomes for farmer drafts                |
| FR-OFF-013 | Queue saturation/age notices shall be local-first, with server-visible escalation only after an … | Not started | No implementation or design yet                                                                         |
| FR-OFF-014 | Account/device partitions, non-exportable possession keys where supported, key binding and revoc… | Partial     | Account and device partitions with key binding for the farmer-draft vault                               |
| FR-OFF-015 | Client schema migrations and releases shall preserve pending vault records, support staged upgra… | Not started | No implementation or design yet                                                                         |
| FR-OFF-016 | Offline archive/recovery shall preserve all unresolved drafts and their dependencies, verify arc… | Partial     | Archive and recovery for farmer drafts (`ARCHIVE_RECOVERY_RESULTS.md`)                                  |

## Data, privacy and governance (FR-DATA)

| ID          | Requirement (shortened)                                                                           | Status      | Evidence or gap                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| FR-DATA-001 | Approved privacy notices shall be language-versioned and reviewable; UI shall record notice deli… | Partial     | Notice-provided flag only; no language-versioned notice management                      |
| FR-DATA-002 | Retention shall be configurable by data category with archive, anonymize, delete and legal-hold … | Not started | No implementation or design yet                                                         |
| FR-DATA-003 | Sensitive fields and document reads shall be purpose-bound, masked by default, separately author… | Not started | No implementation or design yet                                                         |
| FR-DATA-004 | Documents shall have separate metadata, encrypted object storage, document types, evidence statu… | Not started | No implementation or design yet                                                         |
| FR-DATA-005 | Raw survey tracks shall have shorter configurable retention than final polygons and shall not be… | Not started | No implementation or design yet                                                         |
| FR-DATA-006 | Client shall control its business data while developer retains separately agreed software IP; st… | Not started | No implementation or design yet                                                         |
| FR-DATA-007 | Contract exit shall propose a 30-day orderly handover window, subject to signed terms and legal … | Not started | No implementation or design yet                                                         |
| FR-DATA-008 | Import shall accept controlled CSV/Excel templates with mapping, validation preview, row-level e… | Not started | No implementation or design yet                                                         |
| FR-DATA-009 | Import approvals, idempotency, rollback/compensation and correction shall be audited with source… | Not started | No implementation or design yet                                                         |
| FR-DATA-010 | Each requirement and change shall have source, version, owner, approval status and conflict reso… | Partial     | This document, `PHASE_1_SOURCE_CONFLICTS.md`, the board and the decision register       |
| FR-DATA-011 | Change requests shall record technical, security, schedule and cost impacts and require both aut… | Not started | No implementation or design yet                                                         |
| FR-DATA-012 | Final SRS, architecture, roadmap, quotation and Sinhala client explanation shall be prepared bef… | Partial     | Review package v0.9 is imported and marked not client-approved; no signed baseline (G0) |

## Resources and inventory (FR-INV)

| ID         | Requirement (shortened)                                                                           | Status      | Evidence or gap                                                             |
| ---------- | ------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| FR-INV-001 | Resource catalog shall support configurable types, units, categories and organization/program ap… | Design only | ADR 0026 (proposed): exact numerics and append-only ledger; not implemented |
| FR-INV-002 | Every stock-affecting receipt, issue, transfer, return, loss, damage, correction or adjustment s… | Design only | ADR 0026 (proposed): exact numerics and append-only ledger; not implemented |
| FR-INV-003 | Officers may distribute only authorized, already allocated stock while offline, and each issuanc… | Not started | No implementation or design yet                                             |
| FR-INV-004 | Officer confirmation shall be mandatory at pilot; farmer acknowledgment method shall be configur… | Not started | No implementation or design yet                                             |
| FR-INV-005 | Loss and correction transactions shall require approved pilot authorization; returns shall requi… | Not started | No implementation or design yet                                             |
| FR-INV-006 | Each resource shall define authoritative base unit and allowed conversion factors with version/e… | Design only | ADR 0026 (proposed): exact numerics and append-only ledger; not implemented |
| FR-INV-007 | Every quantity-affecting event shall preserve entered quantity/unit and validated normalized bas… | Design only | ADR 0026 (proposed): exact numerics and append-only ledger; not implemented |
| FR-INV-008 | Inter-location transfers shall require sender dispatch and receiver receipt confirmation, includ… | Not started | No implementation or design yet                                             |
| FR-INV-009 | Resource-specific lot tracking shall capture source, batch ID, relevant dates/expiry and traceab… | Not started | No implementation or design yet                                             |
| FR-INV-010 | Quotas shall be configurable by project, resource, cycle, farmer category and approved area, wit… | Not started | No implementation or design yet                                             |
| FR-INV-011 | Validated authoritative parcel area shall be used for area-based quotas; disputed/unverified are… | Not started | No implementation or design yet                                             |
| FR-INV-012 | Offline distribution sync shall use stable mutation IDs, stock allocation version and expected b… | Not started | No implementation or design yet                                             |
| FR-INV-013 | Corrections and reversals shall be compensating transactions linked to original events with reas… | Design only | ADR 0026 (proposed): exact numerics and append-only ledger; not implemented |
| FR-INV-014 | Transfers and allocation receipts shall expose statuses proposed, dispatched, partially received… | Not started | No implementation or design yet                                             |
| FR-INV-015 | Inventory queries, transfers and distribution exports shall honor current RBAC+ABAC, restricting… | Not started | No implementation or design yet                                             |

## Reporting (FR-RPT)

| ID         | Requirement (shortened)                                                                           | Status      | Evidence or gap                 |
| ---------- | ------------------------------------------------------------------------------------------------- | ----------- | ------------------------------- |
| FR-RPT-001 | First release shall include comprehensive role-specific dashboards, charts, KPI summaries, confi… | Not started | No implementation or design yet |
| FR-RPT-002 | The system shall support customizable report definitions and scheduled execution without exposin… | Not started | No implementation or design yet |
| FR-RPT-003 | Reports shall support authorized export to Excel, CSV and PDF, with complete Sinhala/English lab… | Not started | No implementation or design yet |
| FR-RPT-004 | Distinct permissions shall govern dashboard.view, report.view, report.export, report.schedule an… | Not started | No implementation or design yet |
| FR-RPT-005 | Delivery channels shall include dashboard retrieval, notifications and authenticated expiring li… | Not started | No implementation or design yet |
| FR-RPT-006 | Downloads shall reauthorize actor and scope on use and generate export/download audit entries.    | Not started | No implementation or design yet |
| FR-RPT-007 | KPI definitions shall specify source tables, effective date, inclusion/exclusion states, aggrega… | Not started | No implementation or design yet |
| FR-RPT-008 | GIS reports shall separate estimated, surveyed, validated and disputed land areas rather than si… | Not started | No implementation or design yet |
| FR-RPT-009 | Scheduled report execution shall use authenticated service jobs with recipient authorization rec… | Not started | No implementation or design yet |
| FR-RPT-010 | Plan targets shall retain approved/draft source versions and unresolved arithmetic issues; do no… | Not started | No implementation or design yet |
| FR-RPT-011 | Map-based analytics and spatial reporting shall use scope-filtered queries and approved basemap/… | Not started | No implementation or design yet |
| FR-RPT-012 | Report customizations shall be limited to allowed measures/dimensions for the user's context, wi… | Not started | No implementation or design yet |

## Operations and delivery (FR-OPS)

| ID         | Requirement (shortened)                                                                           | Status                | Evidence or gap                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| FR-OPS-001 | Initial production shall use portable Docker deployment on a cost-conscious VPS, with migration … | Not started           | No implementation or design yet                                                                                    |
| FR-OPS-002 | Developer company shall own and operate hosting accounts/services and invoice client under agree… | Not started           | No implementation or design yet                                                                                    |
| FR-OPS-003 | Daily encrypted offsite backups plus feasible WAL archiving shall target proposed 1h RPO and 8h … | Not started           | No implementation or design yet                                                                                    |
| FR-OPS-004 | Production secrets shall be in protected VPS environment files outside Git; cron-based rotation … | Not started           | No implementation or design yet                                                                                    |
| FR-OPS-005 | Monitoring shall cover VPS, API, database, backups, offline sync errors and escalation with sens… | Not started           | No implementation or design yet                                                                                    |
| FR-OPS-006 | Structured UAT shall exercise approved requirements in real field conditions, classify severity … | Not started           | No implementation or design yet                                                                                    |
| FR-OPS-007 | English/Sinhala frontend and GIS interactions shall target WCAG 2.2 AA, with non-drag alternativ… | Partial               | Field touch targets and focus checked in Chromium (PR #74); no WCAG 2.2 AA audit or screen-reader review           |
| FR-OPS-008 | Developer company shall deliver initial role-based training and basic manuals, with additional t… | Not started           | No implementation or design yet                                                                                    |
| FR-OPS-009 | Rollout shall start with complete approved first-release modules in a bounded pilot, then expand… | Not started           | No implementation or design yet                                                                                    |
| FR-OPS-010 | Developer shall operate under recurring hosting/maintenance SLA with severity-based response tar… | Not started           | No implementation or design yet                                                                                    |
| FR-OPS-011 | Production CI/CD shall include staging, automated checks, explicit approval, safe versioned DB m… | Partial               | CI runs audit, lint, formatting, typecheck, tests, builds and a browser suite; no staging or release approval flow |
| FR-OPS-012 | No work shall be described as fully approved or deployment-ready solely due to this provisional … | Implemented (bounded) | No work is described as approved or deployment-ready; every merged slice states its limits                         |

## Security (non-functional) (NFR-SEC)

| ID         | Requirement (shortened)                                                                           | Status                | Evidence or gap                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| NFR-SEC-01 | All protected reads/writes, aggregates, maps and exports shall be denied by default at service a… | Partial               | Deny by default in services, RLS and BFF allow-lists; aggregates, exports and maps beyond the viewport are not built |
| NFR-SEC-02 | Privileged MFA, step-up and session revocation shall be enforced against current database identi… | Partial               | MFA for all staff, session revocation on logout; no step-up or privileged-session policy                             |
| NFR-SEC-03 | Sensitive data shall be encrypted at rest and in transit; field-local vault shall use authentica… | Partial               | Encrypted farmer-draft vault; TLS and at-rest encryption depend on the unchosen hosting                              |
| NFR-SEC-04 | Root and encryption-key rotation shall be controlled, atomic, recoverable and non-destructive; a… | Not started           | Key rotation (SEC-03) not started; automatic rotation conflict is SC-11                                              |
| NFR-SEC-05 | Recovery shall not create an admin decryption backdoor; escrow/recovery keys, approvals and gran… | Not started           | No implementation or design yet                                                                                      |
| NFR-SEC-06 | Data processing shall have recorded lawful purpose and reviewed Sri Lankan legal basis, privacy … | Not started           | No implementation or design yet                                                                                      |
| NFR-SEC-07 | Logs shall exclude secrets, access tokens, full NIC, raw GPS trace and other unnecessary persona… | Partial               | Errors are sanitized and tests assert no private detail; no full log review                                          |
| NFR-SEC-08 | Physical device posture checks must not be claimed if the PWA cannot attest them; unsupported or… | Implemented (bounded) | Device posture is documented as not attested; possession of a browser key is not hardware attestation                |

## Offline (non-functional) (NFR-OFF)

| ID         | Requirement (shortened)                                                                           | Status      | Evidence or gap                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| NFR-OFF-01 | Pilot offline authoring policy shall propose a 7-day maximum since trusted successful online aut… | Not started | No implementation or design yet                                                                                  |
| NFR-OFF-02 | An interrupted/retried offline mutation shall retain stable identities and be idempotent; no con… | Partial     | Idempotent journals for registration, land, geometry and enrollment; offline retry proven for farmer drafts only |
| NFR-OFF-03 | Offline data shall survive ordinary restart/browser application updates where supported and rema… | Design only | ADR 0025 (proposed): survives restart via the existing vault; not implemented                                    |
| NFR-OFF-04 | Survey capture shall visibly detect loss of position updates or low confidence, never invent a w… | Partial     | Walk engine flags weak fixes, jumps and gaps and never interpolates; device behavior untested                    |
| NFR-OFF-05 | Offline map package download shall be limited to authorized areas with rights-verified provider … | Not started | No implementation or design yet                                                                                  |

## Performance and recovery (NFR-PERF)

| ID          | Requirement (shortened)                                                                           | Status      | Evidence or gap                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| NFR-PERF-01 | Proposed benchmark profile uses 3,000 farmer records and 20–40 concurrent staff solely for plann… | Not started | No implementation or design yet                                                  |
| NFR-PERF-02 | Scoped spatial queries shall use appropriate indexes and bounded geometry/viewport limits with o… | Partial     | GiST indexes and bounded viewport limits (PR #50); no load or query-plan testing |
| NFR-PERF-03 | Custom reports and scheduled jobs shall impose query cost/row/time caps and capacity safeguards.  | Not started | No implementation or design yet                                                  |
| NFR-PERF-04 | Concurrent resource issues shall preserve stock invariants using database-level locking, constra… | Design only | ADR 0026 (proposed): exact numerics and append-only ledger; not implemented      |
| NFR-PERF-05 | Proposed production backup RPO 1 hour and RTO 8 hours are contractual candidates, not guaranteed… | Not started | No implementation or design yet                                                  |
| NFR-PERF-06 | Monitoring shall detect failed backup, API outage, DB saturation and sync backlog with assigned … | Not started | No implementation or design yet                                                  |

## Usability and accessibility (NFR-UX)

| ID        | Requirement (shortened)                                                                           | Status      | Evidence or gap                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| NFR-UX-01 | First-release target is WCAG 2.2 Level AA for web views, forms and GIS with accessible alternati… | Not started | No implementation or design yet                                                                         |
| NFR-UX-02 | Field officer interfaces shall prioritize readable high-contrast copy, large targets and sunligh… | Partial     | Large targets and readable copy on the field links (PR #74); no sunlight or user study                  |
| NFR-UX-03 | English/Sinhala language selection shall cover navigation, validation, status, accessibility nam… | Partial     | English and Sinhala on the field and admin screens; not every message and accessibility name is covered |
| NFR-UX-04 | Every queued operation shall clearly distinguish local save, pending, syncing, confirmed, reject… | Partial     | Sync states shown for farmer drafts; not for survey drafts                                              |
| NFR-UX-05 | Documentation/training shall show role-specific offline/GIS workflows and security-limited actio… | Not started | No implementation or design yet                                                                         |

## Operations (non-functional) (NFR-OPS)

| ID         | Requirement (shortened)                                                                           | Status                | Evidence or gap                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| NFR-OPS-01 | Deployments shall be reproducible under developer-operated accounts, with container isolation an… | Not started           | No implementation or design yet                                                                             |
| NFR-OPS-02 | Schema migration shall be versioned, repeat-safe where designed, and compatible with at least th… | Partial               | Versioned, checksummed native migration runner with tests; rollback and compatibility windows not specified |
| NFR-OPS-03 | Backup data and essential decryption material shall survive production VPS destruction, with sep… | Not started           | No implementation or design yet                                                                             |
| NFR-OPS-04 | Support coverage, exclusions, incident severity, response targets and client escalation shall be… | Not started           | No implementation or design yet                                                                             |
| NFR-OPS-05 | Requirements, ADRs, releases, risk exceptions and approvals shall retain version, author, decisi… | Partial               | ADRs, the board, the conflict register and the review log keep decisions and authorship                     |
| NFR-OPS-06 | New features shall not claim accessibility or security certification from CI-only pass; human ac… | Implemented (bounded) | CI results are never presented as accessibility or security certification                                   |
