# Session resume point

**Purpose:** where work stood when a session paused, so the next session (or a scheduled resume) continues without re-deriving it. Read [AGENTS.md](../../AGENTS.md) first. **This file is a snapshot, not a source of truth, and it grants no approval.** Merges, privileged changes and production-affecting security changes need the owner's own explicit approval. **Before acting, re-check every head, CI state, merge state and open issue live on GitHub**; if anything here disagrees with GitHub, GitHub wins and this file is updated.

**Snapshot taken:** 20 Nov 2026, `main` at `19010a3`. **Never store a secret, key, token or personal data here.**

## Merged so far (on owner approval)

#108 (SEC-A1 start-up refusal), #109 (capabilities contract rev 2, still PROPOSED), #110 (owner security decisions S1 to S13), #111 (SEC-A2 security events), #121 (nested glass filters; closed issue #101), #122 (SEC-A4 budgets design, PROPOSED), #124 (conflict-marker guard in the structure check).

## Open pull requests (last-seen heads; every PR is green on its last-seen head)

| PR   | Subject                                                                         | Last head  | What it needs                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #112 | SEC-A9 CI secret scanning (CI change)                                           | `1b882a9`  | **The owner's final merge authorization** (presented). After merge: run the "Secret scan" workflow manually (all-ref audit) and record the actual result in `SECRET_SCANNING.md` |
| #114 | SEC-A2 hash-key production requirement (docs)                                   | `0dc6d05`  | Conflict with main in shared docs tables; docs-only normal review                                                                                                                |
| #115 | SEC-A3 provider-neutral edge and origin ADR (PROPOSED, docs)                    | `815a400`  | Conflict with main; keep PROPOSED; docs-only normal review                                                                                                                       |
| #116 | GoviAxis product name in UI, titles and docs                                    | `6dc436e`  | **Explicit owner confirmation that GoviAxis is the final product name** (no trademark or domain availability is verified); then a conflict sync                                  |
| #117 | Stitch MCP declaration in `.mcp.json` (no key committed)                        | `41695db`  | Review of configuration and secret handling; conflict sync; the owner sets `STITCH_API_KEY` in the environment settings and rotates the key that was pasted into chat            |
| #118 | Stitch UI/UX review (docs)                                                      | `fd78ac8`  | Conflict with main; docs-only normal review                                                                                                                                      |
| #119 | This file and the session-continuity rule in AGENTS.md (docs)                   | see GitHub | Documentation-only normal review                                                                                                                                                 |
| #120 | SEC-A2 fix: pending security-event counts reach the log (issue 113)             | `da07ac6`  | **Held** for an independent qualified AppSec review of the flush implementation and its failure-handling tests; internal review and green CI do not satisfy it                   |
| #123 | Username and password login proposal and authentication policy (docs, PROPOSED) | `f4ef35e`  | Stays separate; **server-side MFA unchanged** until the policy is approved, independently reviewed, implemented and tested; conflict sync                                        |
| #125 | SEC-A4 measurement protocol and safe harness (test tooling)                     | `a633030`  | Fixes issue #126 (loopback guard now numeric-only with no byte before the peer is verified); CI on the new head to confirm; conflict sync done on this head                      |

Syncing the docs-only PRs with `main` should be done **one at a time, after #112 is merged**, with fresh CI after each, and the conflict-marker guard run on each resolved tree before pushing. The shared handover, audit and review-log tables are the usual conflict points.

## Open issues

- **#64** shared BFF login throttling: stays open; the topology, client attribution and lockout-abuse work is not done (deployment blocker).
- **#71** admin and field UX redesign umbrella: stays open; the Stitch-based work continues.
- **#113** security-event counts: closes when #120 merges, after independent review.
- **#126** measurement harness loopback safety: closes when #125 merges.

## Next steps, in order

1. Merge #112 when the owner authorizes; then run and record the all-ref audit.
2. Sync and merge the docs-only PRs (#114, #115, #118, #119) one at a time through normal review.
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
