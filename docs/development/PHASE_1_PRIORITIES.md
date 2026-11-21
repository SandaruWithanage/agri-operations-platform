# Phase 1 priority checklist

Reviewed 21 November 2026 against main at `2f98c7b`. Use the [living handover](PROJECT_HANDOVER.md) for task IDs and implementation evidence and [GitHub](https://github.com/SandaruWithanage/agri-operations-platform/pulls) for live review status. Work in the order below where dependencies allow. Update the checklist and handover in the PR that changes a task's status.

## P0 — Start now

- [x] Add a two-account enrollment regression through the authenticated BFF, NestJS and PostgreSQL. Check scoped create, list and detail, cross-scope denial, and revocation during an active session. PRJ-04.
- [x] Exercise the shipped enrollment directory in Chromium, including detail denial, late response cleanup and a second account after sign-out. PRJ-04D.
- [ ] Verify enrollment creation, policy editing and withdrawal through the shipped bilingual admin forms, including fixed retries and recovery after denial or an uncertain response. PRJ-03/04.
- [ ] Move the independent AppSec/PostgreSQL review forward. Review the read-only IAM catalog in [#130](https://github.com/SandaruWithanage/agri-operations-platform/pull/130) before its stacked audit foundation in [#131](https://github.com/SandaruWithanage/agri-operations-platform/pull/131). Track the independent disposition of the security event fix separately in [#120](https://github.com/SandaruWithanage/agri-operations-platform/pull/120). ACC-01, IAM-01.
- [ ] Resolve [issue #64](https://github.com/SandaruWithanage/agri-operations-platform/issues/64). Confirm the hosting and proxy topology, obtain authorization for disposable-stack measurements, validate shared-NAT and proxy handling, and review the resulting login policy and limits before rollout. SEC-04, OPS-04.
- [ ] Record the decisions needed for each dependent workflow, starting with DEC-02 permissions and delegation, DEC-03 land relationships, DEC-04 enrollment, DEC-06 data retention, DEC-07 devices and recovery, and DEC-08 hosting and operating ownership. [Decision register](../requirements/OPEN_DECISIONS.md).

## P1 — Complete the pilot workflows

- [ ] Deliver integrated organization and permission administration after DEC-02 and Gate G1. Implement audited delegated changes in bounded slices, then account/MFA recovery and device administration. Validate cross-organization isolation, revocation, expiry and prevention of self-escalation before enabling writes. IAM-01/02/03, OPS-02.
- [ ] Complete farmer lifecycle and reassignment, approved optional fields and privacy controls. Add durable draft/receipt recovery under the agreed retention policy and close conflict, rejection and lost-key recovery cases. FAR-04/05, DATA-01, REC-02/03, OFF-02.
- [ ] Complete land relationships and scoped map/search using approved data sources. Add offline GPS capture and recovery after the device and data gates pass. LAND-02/03, OFF-03.
- [ ] Complete explicit enrollment and project lifecycle under DEC-04. Add field/offline enrollment only after DEC-12, independent review and explicit enablement. Verify resubmission under current permissions, farmer state and project policy. PRJ-03/04, OFF-04.
- [ ] Deliver initial resources, approved supporting documents and scoped reports or exports after their business rules and upstream scopes are confirmed. Reconcile authorized output with source records. RES-01, DOC-01, RPT-01.
- [ ] Finish the admin and field usability work aligned with the approved design direction. Validate critical bilingual flows with native speakers, keyboard and screen-reader users, and field officers outdoors. [Issue #71](https://github.com/SandaruWithanage/agri-operations-platform/issues/71), ACC-02.

## P2 — Prove operational readiness and release

- [ ] Confirm environments, data residency, access owners, key custody, incident responsibilities and recovery objectives. Prepare the deployment in parallel with workflow implementation as those decisions resolve. OPS-04/05, DEC-08.
- [ ] Rehearse migration, backup/restore, credential and key rotation, release and rollback on a representative staging environment. Verify TLS, proxy trust, isolated runtime identities, monitoring, alerts and recovery runbooks. SEC-03/04, OPS-03/04/05.
- [ ] Complete independent security review of the actual deployment and resolve findings or record approved dispositions. Demonstrate physical-device security, offline restart and recovery, and collect client UAT acceptance against the agreed Phase 1 scope. ACC-01/02/03.
- [ ] Release after the deployment blockers and acceptance gates are closed. Record the approved revision, configuration, ownership and rollback procedure in the release evidence.

A resume after a quota warning should re-check live PR heads, checks and current instructions. Use [SESSION_RESUME.md](SESSION_RESUME.md) to park unfinished work and schedule a one-shot continuation when the reset time is known. The resume grants no approval to merge, change privileges, run measurements or deploy.
