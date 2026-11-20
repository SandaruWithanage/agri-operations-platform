# Session resume point

**Purpose:** where work stood when a session paused, so the next session (or a scheduled resume) continues without re-deriving it. Read [AGENTS.md](../../AGENTS.md) first. **This file is a snapshot, not a source of truth, and it grants no approval.** Merges, privileged changes and production-affecting security changes need the owner's own explicit approval. **Before acting, re-check every head, CI state, merge state and open issue live on GitHub**; if anything here disagrees with GitHub, GitHub wins and this file is updated.

**Snapshot taken:** 20 Nov 2026, `main` at `ce7b84f`. **Never store a secret, key, token or personal data here.**

## Merged so far (on owner approval)

#108 (SEC-A1 start-up refusal), #109 (capabilities contract rev 2, still PROPOSED), #110 (owner security decisions S1 to S13), #111 (SEC-A2 security events), #121 (nested glass filters; closed issue #101), #122 (SEC-A4 budgets design, PROPOSED), #124 (conflict-marker guard in the structure check), **#127 (scoped override `@prisma/config>effect` 3.22.4 for the high-severity advisory GHSA-7589-6fvf-x4pw; a fix, not an exemption; merged on the owner's explicit authorization at `bb075a5` as `0bdac7a`)**; **#112 (SEC-A9 secret scanning, owner-merged from head `7bfe990` as `233bcc8`); #125 (SEC-A4 measurement harness, owner-merged from head `11eb0d0`; closed issue #126); #119 (this file and the continuity rule).**

## Open pull requests (last-seen heads)

| PR   | Subject                                                                         | Last head  | What it needs                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #114 | SEC-A2 hash-key production requirement (docs)                                   | `0dc6d05`  | Conflict with main in shared docs tables; docs-only normal review                                                                                                     |
| #115 | SEC-A3 provider-neutral edge and origin ADR (PROPOSED, docs)                    | `815a400`  | Conflict with main; keep PROPOSED; docs-only normal review                                                                                                            |
| #116 | GoviAxis product name in UI, titles and docs                                    | `6dc436e`  | **Explicit owner confirmation that GoviAxis is the final product name** (no trademark or domain availability is verified); then a conflict sync                       |
| #117 | Stitch MCP declaration in `.mcp.json` (no key committed)                        | `41695db`  | Review of configuration and secret handling; conflict sync; the owner sets `STITCH_API_KEY` in the environment settings and rotates the key that was pasted into chat |
| #118 | Stitch UI/UX review (docs)                                                      | `fd78ac8`  | Conflict with main; docs-only normal review                                                                                                                           |
| #120 | SEC-A2 fix: pending security-event counts reach the log (issue 113)             | `da07ac6`  | **Held** for an independent qualified AppSec review of the flush implementation and its failure-handling tests; internal review and green CI do not satisfy it        |
| #123 | Username and password login proposal and authentication policy (docs, PROPOSED) | `f4ef35e`  | Stays separate; **server-side MFA unchanged** until the policy is approved, independently reviewed, implemented and tested; conflict sync                             |
| #128 | Record the GitHub-hosted all-ref secret audit result (docs)                     | see GitHub | Docs-only normal review. Records run 44681069474 (success, 0 findings, both scan steps executed) and the limit that the ref count is not printed                      |

Syncing the docs-only PRs with `main` should be done **one at a time, after #112 is merged**, with fresh CI after each, and the conflict-marker guard run on each resolved tree before pushing. The shared handover, audit and review-log tables are the usual conflict points.

## Post-merge facts worth keeping

- The GitHub-hosted all-ref secret audit ran on `233bcc8` (manual dispatch, run 44681069474): both steps executed, 458 files, 0 findings, 0 waived. The scanner does not print how many refs it covered, so that count is not recorded (small follow-up: print it).
- The measurement harness is on `main`. It accepts only numeric loopback targets, refuses names, and sends no byte before the peer is verified; **no measurement has been run**, and a real run needs the owner's written authorization reference.
- `main`'s dependency audit passes with only the owner-approved picomatch exemption (re-check by 15 Dec 2026).

## Dependency advisories can break every PR's CI

A newly published advisory can fail the audit step of every PR at once, because the gate reads the live advisory database (this happened on 20 Nov 2026 with `effect`, fixed by #127). First check whether `main` fails the same way; fix with a reviewed dependency change; **never skip the gate, never add an exemption without the owner's decision, and never commit the `auditConfig` block that `pnpm audit --ignore` writes into `pnpm-workspace.yaml`**. See `DEPENDENCY_POLICY.md`.

## Open issues

- **#64** shared BFF login throttling: stays open; the topology, client attribution and lockout-abuse work is not done (deployment blocker).
- **#71** admin and field UX redesign umbrella: stays open; the Stitch-based work continues.
- **#113** security-event counts: closes when #120 merges, after independent review.
- **#126** measurement harness loopback safety: **closed** by #125 (verified fix merged).

## Next steps, in order

1. Review and merge the docs-only PRs one at a time (#114, #115, #118, #128), each synced with `main` first, with fresh CI and the conflict-marker guard run on the resolved tree before pushing. The owner decides each merge.
2. Small follow-up: make the secret scanner print how many refs it covered, so an audit result states its own coverage.
3. Keep #116, #120 and #123 held as above.
4. SEC-A5 login-protection design on decision D3 option B (design only); benchmark PostgreSQL authorization and query limits on a disposable stack before any SEC-A6 migration; Stitch-based UI changes from `STITCH_UI_UX_REVIEW.md`, each a small reviewed PR, after the owner's decisions there.
5. No measurement has been run; the harness may be used only on a disposable local stack with the owner's written authorization reference.

## Do not

- Merge anything without the owner's explicit approval; green CI alone is never authorization. A recommendation in a review message is not an approval unless it says so.
- Start privileged IAM schema changes, capabilities C1, C2 or C3, any removal or weakening of server-side MFA, or any deployment needing unresolved approval.
- Activate any unmeasured limit, or run load or penetration tests against live infrastructure.
- Record DEC-02 Q1 to Q12 as confirmed without the owner's word "confirm".
- Claim Gate G1, independent review, hosting validation, real-device testing, client approval or production security acceptance.
- Use or store the Stitch key that was pasted into a chat; it is exposed and must be rotated.
- Commit a conflict-resolved file without running `node scripts/check-structure.mjs` and scanning for markers.

## Open owner items

Final merge authorization for #112; confirmation of the GoviAxis name; choice of authentication policy option and its values; an independent AppSec and PostgreSQL reviewer (none assigned); hosting (OPS-04); incident and alert ownership; approved organisation naming for the sign-in and field screens; scope of the loan, harvest, survey and import/export screens in Stitch; native-speaker review of Sinhala text; DEC-02 Q1 to Q12 "confirm" plus open points A and B; the next session start time for scheduled resumes; ADR 0022 addendum approval.
