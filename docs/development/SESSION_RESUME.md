# Session resume point and handoff

**Purpose:** where work stood when a session paused, so the next agent (or a scheduled resume) continues without re-deriving it. Read [AGENTS.md](../../AGENTS.md), then [PROJECT_CONTEXT](../PROJECT_CONTEXT.md) and the [project handover](PROJECT_HANDOVER.md) (the stable task register). **This file is a snapshot, not a source of truth, and it grants no approval.** Merges, privileged changes and production-affecting security changes need the owner's own explicit approval. **Before acting, re-check every head, CI state, merge state and open issue live on GitHub**; if anything here disagrees with GitHub, GitHub wins and this file is updated.

**Snapshot taken:** 21 Nov 2026, `main` at `2f98c7b`. **Never store a secret, key, token or personal data here.** The platform is **not production ready**: Gate G1, independent AppSec/PostgreSQL review (no reviewer assigned), hosting (OPS-04), incident ownership, real-device testing, client acceptance and DEC-02 are all open.

## 1. What this is

**GoviAxis** (owner-supplied name, still awaiting official confirmation in #116; the code still says the working name) is an agricultural operations platform: a pnpm/Turborepo monorepo with two Next.js apps (admin web and an offline-capable field PWA), same-origin BFFs, a NestJS API and PostgreSQL/PostGIS that owns authority (ABAC, FORCE RLS, audit). Phase 1 scope: IAM/ABAC and core database; farmer and land registration; officer responsibilities; project enrollment; simple GPS pins; resource records; offline synchronization. Out of scope: farmer portal (Phase 2), harvest procurement, transport, financial settlement, insurance, advanced surveying, new workflow engines. GPS points are identification only, never legal boundaries or verified acreage.

## 2. What exists (delivered, on `main`)

Full detail and evidence are in the handover register (section 3 of [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md)); in short:

- **Foundation and security runtime:** monorepo, shared packages (`@agri/ui`, design tokens, validation, i18n, sync), Argon2id password, encrypted MFA, PostgreSQL sessions, cookie BFF with CSRF, short-lived JWTs, signed per-transaction actor context, approved-browser-key device proof, ten restricted LOGIN identities.
- **Farmer workflows:** minimal registration (field and admin), registry and detail, review queue, verification, bounded correction, receipts, audit view, duplicate-risk flagging, encrypted offline drafts and sync (Dexie), archive recovery.
- **Land:** reported PostGIS identification with online GPS capture, scoped directory, provisional polygon store (awaiting review).
- **Projects:** catalog, versioned editing, provisional explicit enrollment with policy administration and bilingual admin screens.
- **UI:** one frosted-glass language with fallbacks, shared tokens, field home task order, UI development rules (shared components first, permission-code driven actions; a hidden button is never a security check).
- **Security programme (SEC-AUDIT-01):** start-up refusal (SEC-A1), privacy-safe security events (SEC-A2), CI secret scanning with an all-ref audit (SEC-A9), conflict-marker guard in the structure check, request-budget design and a safe loopback measurement harness (SEC-A4, **no measurement has ever been run**), dependency override for GHSA-7589-6fvf-x4pw.
- **Merged on owner approval so far:** #108, #109, #110, #111, #112, #114, #119, #121, #122, #124, #125, #127, #128, #129 (plus earlier work).

## 3. Open pull requests (last-seen heads; re-check live)

| PR   | Subject                                                                | Head      | State and what it needs                                                                                                                                |
| ---- | ---------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #115 | SEC-A3 edge and origin ADR (PROPOSED, docs)                            | `e9aa0de` | Synced with main, mergeable, CI green. Owner decides the merge. Keep PROPOSED.                                                                         |
| #118 | Stitch UI/UX review (docs)                                             | `59e5cb6` | Synced with main, mergeable, CI green. Owner decides the merge.                                                                                        |
| #116 | GoviAxis product name in UI, titles and docs                           | `6dc436e` | **Held for explicit owner confirmation of the name** (no trademark or domain availability is verified); then a conflict sync.                          |
| #117 | Stitch MCP declaration in `.mcp.json` (no key committed)               | `41695db` | Owner must set `STITCH_API_KEY` and **rotate the key that was pasted into a chat**; conflict sync needed.                                              |
| #120 | SEC-A2 fix: pending event counts reach the log (issue #113)            | `da07ac6` | **On hold** for an independent qualified AppSec review; green CI and internal review do not satisfy it.                                                |
| #123 | Username/password login and authentication policy (docs, PROPOSED)     | `f4ef35e` | Stays separate; **server-side MFA unchanged** until the policy is approved, independently reviewed, implemented and tested; conflict sync needed.      |
| #130 | IAM-01 P1-03a read-only role/permission catalog (schema; migration 27) | `bb59971` | **Open for Gate G1 independent review**; will not merge before it and the owner's explicit authorization. Review package is in the PR (see section 5). |
| #131 | IAM-01 P1-03b1 grant `origin` columns and append-only grant audit (28) | `9990a55` | **Stacked on #130** (base is the #130 branch); no writer; same review gate; retarget after #130 lands.                                                 |

Syncing a docs PR with `main`: do it one at a time, fresh CI after each, run `node scripts/check-structure.mjs` on the resolved tree, and keep every legitimate entry in the shared handover, audit and review-log tables (the usual conflict points).

## 4. Open issues

**#64** shared BFF login throttling and client attribution: a **deployment blocker**, not done. **#71** admin and field UX redesign umbrella (Stitch-based, small reviewed PRs). **#113** security-event counts: closes only when #120 merges after independent review.

## 5. IAM-01 (organization and permission administration) state

Design: [ADR 0022](../decisions/ADR-0022-dynamic-role-and-assignment-administration.md) (PROPOSED). Slices: P1-03a (#130, read-only catalog, role versions, scoped reads), P1-03b1 (#131, plumbing only). **Owner direction 21 Nov 2026:** keep #130 open for independent review; for P1-03b onward do **design, threat analysis and synthetic test planning only**. Privileged role mutations, materialized grants, access approvals and account-permission changes stay **inactive** until DEC-02 and the security gates are resolved. Read these first:

- [Independent-review package for #130](../security/IAM_P1_03A_INDEPENDENT_REVIEW_PACKAGE.md) (as-built privilege inventory; the `UPDATE(active)` question; lock and concurrent-revocation evidence; 17 mutation checks; what is not claimed).
- [P1-03b design, threat analysis and synthetic test plan](../security/IAM_P1_03B_DESIGN_THREAT_AND_TEST_PLAN.md) (gating conditions, slicing b2/b3/c, 14 threats, 20 test cases). It proposes a link table instead of a column on `authn.account`; that needs owner agreement.

## 6. What is left, and where to begin

**Owner priority (21 Nov 2026):** after the review and hold tasks, prioritize integrated organization/permission administration and complete farmer, land and project workflows. **Stop adding unrelated documentation.**

Start here, in order:

1. Re-check GitHub (heads, CI, merges, issues, comments). Update this file if it disagrees.
2. Work that needs **no privileged IAM change**: read [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md) section 5 and the `Pending`/`Partial` items; pick the next vertical gap in the farmer, land and project workflows that does not depend on IAM-01 writes (for example completing enrollment UX against the existing provisional API, durable online drafts REC-02, offline land/GPS OFF-03 design review, the LAND-02 relationship decisions as design) and **say what you chose before building it**.
3. Items that are **blocked** (do not start): IAM-02/03, FAR-04/05, LAND-02 implementation, OPS-02, RES-01, PRJ-03/04 completion, REC-03, SEC-03 (all depend on IAM-01 writes, DEC-02 or client decisions); OPS-04/05 and ACC-01..03 (hosting, reviewers, devices, client).
4. Small follow-up: make the secret scanner print how many refs it covered (a code PR needing explicit merge approval).
5. SEC-A5 login-protection design (decision D3 option B, design only); benchmark PostgreSQL limits on a disposable stack before any SEC-A6 migration (needs the owner's written authorization reference).

## 7. Working method that this repository enforces

- **Every merge needs the owner's explicit approval of a named head.** CI green is not authorization. A recommendation in a message is not an approval unless it says so. Never push to `main`, force-push or merge on your own.
- **Living docs in the same PR:** handover completion-log row and task status, review-log row (replace `#PR` with the real number after opening the PR), setup/domain guides, open decisions. No completion percentages.
- **Test evidence:** state what ran, where (local, CI, disposable stack) and what it does not prove. Mutation-check isolation and integrity tests: remove the guard and the test must fail. Report failures and flakiness plainly.
- **Local database tests** (`tests/authn-migration.test.ts`, one large suite that applies the migrations in a hard-coded list and drops the schemas at the end; skipped without `DATABASE_TEST_URL`; CI provides a PostGIS service): PostgreSQL 16 and PostGIS are installed; `initdb` must run as the `postgres` user in a directory that user can reach (for example under `/var/tmp`), not under the scratchpad. **Do not pre-create the `postgis` or `pgcrypto` extensions** (the migrations create them). Roles are cluster-wide, so **wipe and re-init the cluster between runs**. A new migration needs three edits: the manifest, the suite's migration list and its teardown role/schema lists, and the count in `tests/native-migrations.test.ts`. Tear the disposable cluster down afterwards. Synthetic data only.
- **Node and typecheck:** the repo targets Node 26; the sandbox has Node 22 (a warning, tests still run). The repo-wide `pnpm typecheck` fails locally with `Exec format error` for two packages; each package passes on its own and CI runs it.
- **GitHub:** use the GitHub MCP tools (no `gh` for PRs); `gh api search/...` only for search. Do not comment on GitHub unless asked.

## 8. Pitfalls already hit (do not repeat)

- Prettier turns conflict markers inside tables into table rows; **always** run `node scripts/check-structure.mjs` and a marker scan before committing a resolved file, and chain resolution steps with `&&` so a failed step stops the rest.
- Edit scripts must tolerate Prettier's table re-padding; assert that exactly one match exists.
- A newly published dependency advisory can fail the audit gate of every PR at once: check whether `main` fails the same way, fix through a reviewed dependency change, never skip the gate. `pnpm audit --ignore` writes an `auditConfig` block into `pnpm-workspace.yaml`; never commit it.
- Never ask a database connection for its backend id while it is blocked on a lock (read ids first). A test that asserts a refusal can hide a leaked privilege behind RLS; assert privileges directly.
- The sandbox classifier blocks `git reset --hard`; use `git checkout -B <branch> origin/<branch>` instead.
- The Stitch key pasted into a chat is exposed and must be rotated; do not use or store it. `chatgpt.com` is not reachable from the sandbox.

## 9. Do not

- Merge anything without the owner's explicit approval; start privileged IAM mutations, materialized grants, approvals or account-permission changes; start capabilities C1, C2 or C3; remove or weaken server-side MFA; activate any unmeasured limit; run load or penetration tests against live infrastructure.
- Record DEC-02 Q1 to Q12 as confirmed without the owner's word "confirm". Claim Gate G1, independent review, hosting validation, real-device testing, client approval or production security acceptance.
- Weaken authentication, authorization or audit requirements to speed up development.

## 10. Open owner items

DEC-02 Q1 to Q12 and points A/B; the client permission matrix; an independent AppSec and PostgreSQL reviewer (none assigned); the `UPDATE(active)` decision and the person-link-table agreement; GoviAxis confirmation (#116); authentication policy option and values (#123); hosting (OPS-04); incident and alert ownership (OWNER-S5); approved organisation naming for sign-in screens; scope of the Stitch loan, harvest, survey and import/export screens; Sinhala native-speaker review; ADR 0022 addendum approval; rotation of the exposed Stitch key; and the next session start time for scheduled resumes (AGENTS.md session-continuity rule).
