# Secret scanning (SEC-A9)

Status: **implemented as a dependency-free scanner and a CI workflow; the false-positive and incident-response procedures below are PROPOSED and not yet approved by the owner.** Engineering evidence only: synthetic tests and a local scan of this repository. Internal review, not independent. Not production-proven. Related: audit finding F-09, threat T18, owner direction OWNER-S5 (incident ownership is pending assignment).

## What it does

`scripts/secret-scan.mjs` scans (1) every tracked file and, with `--history`, (2) every **added** line of every commit reachable from the checked-out commit (so a secret that was committed and later deleted is still found). `--all` widens the history scan to every fetched ref; it runs weekly and is for audits, because it also sees other open branches.

It reports **rule, file, line, commit (history only) and a 12-character fingerprint of the match. It never prints a matched value**, so a CI log cannot itself leak a secret. Exit status 0 is clean, 1 means findings or an unused waiver, 2 means **the scan could not be completed** (see below). A scan that could not finish is never reported as clean.

Run locally:

```bash
node scripts/secret-scan.mjs            # tracked files
node scripts/secret-scan.mjs --history  # plus history reachable from HEAD
```

CI: `.github/workflows/secret-scan.yml` runs it on every pull request and push to `main`, with full history (`fetch-depth: 0`), and weekly with `--all`. It uses only the already-pinned `actions/checkout` and `actions/setup-node` versions and `contents: read`; no third-party scanner or action is introduced.

## When the scan cannot complete (exit 2, never clean)

Each of these ends with exit status 2, a fixed-text message (paths, error codes and exit statuses only) and the line "No result is reported: an incomplete scan is not a clean scan." Messages never contain file contents, git output or a matched value; git's own error text is deliberately not echoed.

- `git` cannot be run, is killed, or exits non-zero (`ls-files`, `rev-parse`, `log`), or its output cannot be parsed.
- `git ls-files` lists nothing, or the command is not run inside a repository.
- A tracked file **cannot be read** (permission, I/O error, missing from the working tree). The message names the path and the error code. This is distinct from a **deliberate exclusion**, which is counted and reported, never an error: a path pattern (`pnpm-lock.yaml`, images and similar), content over 1.5 MB (each path is listed as `NOT SCANNED`), binary content, a symbolic link, a submodule.
- `--history` on a shallow clone (a truncated history proves nothing), or `git log` returning no commits.
- An unknown argument, or `--all` without `--history` (a mistyped flag must not silently skip the history scan).

Files are opened once and checked and read through the same descriptor, so a file cannot change between the check and the read (CodeQL file-system race).

## What it detects

Named, high-confidence formats: private key blocks, AWS access key ids, GitHub tokens, Slack tokens, Google API keys, live Stripe keys, npm tokens and JSON Web Tokens. Two more generic rules, **URL with an embedded password** and **secret-looking assignment** (a name containing secret, password, token, api key, private key or credential assigned a long string), ignore obvious placeholders: values containing words such as `synthetic`, `example`, `change-this`, `replace`, `test`, `fake`, environment lookups, template syntax, a single repeated character, or a bare word such as `PASSWORD`.

## Conventions that keep it quiet and honest

- **Deliberately fake secrets in tests and examples are named `synthetic-…`** (or contain another placeholder word). That is why the repository scans clean with no waivers.
- **Tests that plant secrets assemble them at run time**, so a test file contains no literal that matches a rule (`tests/secret-scan.test.ts` does this).
- Example environment files carry no value: `.env.example` documents names only.

## Limits (read before relying on it)

This is a small, reviewable, rule-based scanner. It is **not** a replacement for a mature tool and does not claim equal coverage.

- **Rule coverage is limited** to the formats above plus two generic patterns. A secret in another format, or one that does not sit in a recognizable assignment, will not be found. There is no entropy-based detection (it is noisy and was deliberately left out).
- The generic rules' placeholder filter means a real secret that happens to contain a word such as `test` would be missed by those two rules. High-confidence rules are not filtered.
- It does not scan binary files, `pnpm-lock.yaml`, files over 1.5 MB (listed in the output, not silently ignored), lines over 2000 characters, pull request text, issue comments, build artifacts or logs.
- History scanning covers added lines reachable from the checked-out commit; it cannot see content that was force-pushed away elsewhere.
- **The weekly `--all` audit also sees merged feature branches that still exist.** A squash merge removes feature-branch commits from `main`, but the branch ref keeps them until it is deleted. Verified on 19 Nov 2026 after the SEC-A2 squash merge: the scan of the merged history (`--history`) reported 0 findings, while `--history --all` over all fetched refs reported exactly one: the synthetic CSRF fixture in an early commit of the still-existing branch `claude/sec-a2-security-events`. That commit is not on `main`. The correct responses are to delete the merged branch (an owner action) or, if it must stay, record a time-limited waiver under Procedure A (owner approval). History is never rewritten to hide a finding. No waiver has been added.

  **Resolution (owner direction, 19 Nov 2026): delete the obsolete branch; do not weaken detection or add a waiver.** The branch `claude/sec-a2-security-events` was squash-merged as #111 and its head equals the merged head (`aed27ea`), and no other remote ref holds the old commit. This session could not delete it (the git proxy refused the delete; there is no branch-delete tool here), so **the deletion is an owner action in GitHub and has not happened**. Evidence so far, run locally on 19 Nov 2026: with the remote branch present, `--history --all` over 180 refs reported the one finding above; with that ref excluded, 179 refs reported **0 findings**. After the owner deletes the branch, run the "Secret scan" workflow manually (the all-ref audit step now also runs on `workflow_dispatch`) and record the result here; until that run is green the all-ref audit is **not** verified clean.

- Adopting a maintained scanner in addition (for example a gitleaks-style tool) is a reasonable later step. It adds a third-party dependency and needs the owner's approval and a supply-chain review, so it is not done here.

## Procedure A: a finding that is a false positive (PROPOSED)

1. **Prefer fixing the cause:** rename a fake value to `synthetic-…`, or assemble it at run time in a test. Most false positives end here with no waiver.
2. If a waiver is unavoidable, add an entry to `.secret-scan-allowlist.json` with the rule, the **fingerprint** and path shown by the scanner, a written reason (at least 20 characters) explaining why it is not a credential, and an **expiry no more than 180 days away**. The scanner rejects entries without a reason, with an unknown field, a duplicate, an expiry in the past or more than 180 days away, and it fails on a waiver that no longer matches anything, so waivers cannot quietly become permanent.
3. The pull request must be reviewed by someone other than the author. The reviewer confirms the value is not a credential for any real system. **If there is any doubt, treat it as a real secret (Procedure B).**
4. Waivers are re-reviewed when they expire. Expiry makes CI fail on purpose.

## Procedure B: a finding that is a real secret (PROPOSED)

Treat the secret as **compromised from the moment it was pushed**, even on a private branch or a closed pull request.

1. **Contain first.** Revoke or rotate the credential immediately; do not wait for history to be cleaned. Rotate anything derived from it.
2. **Do not spread it.** Never paste the value into an issue, pull request, chat or log. Refer to it by rule, path, commit and fingerprint only.
3. **Assess exposure.** Establish when it was pushed, who or what could read it (public or private repository, forks, CI logs), and check the provider's audit or access logs for use between the push and the rotation.
4. **Remove from the code** in a normal pull request and move the secret to the approved secret store.
5. **History:** the repository policy forbids force-pushing or rewriting `main`, and rotation already neutralizes the secret. Rewriting history is a separate decision that needs the owner's explicit approval and a plan for forks and clones; it is not the primary remedy.
6. **Preserve evidence:** record the commit, path, rule, fingerprint, discovery time, who was told, the rotation time and the exposure assessment in the [security review log](../testing/PHASE_1_PR_SECURITY_REVIEW_LOG.md) and the handover.
7. **Learn:** add a rule or test if the scanner missed something, fix the cause that let it be committed, and note it in the threat model.

**Ownership:** the incident owner and the notification path are **pending assignment** (OWNER-S5). Until assigned, the engineer who finds a real secret must tell the project owner immediately and not close the finding before rotation is confirmed. No response-time targets are set here because no owner exists to meet them.

## Verification (synthetic)

47 automated tests (plus one that needs a non-root user and is skipped as root, so it runs in CI): every rule detects a run-time-assembled synthetic token; no matched value appears in any output; placeholder and non-secret lines are ignored; the allowlist parser rejects every malformed or expired case and caps waivers at 180 days; a waiver applies only to an exact rule, fingerprint and path and unused waivers are reported; real temporary git repositories prove that a tracked secret is found, lockfiles, binaries and huge files are skipped, a **committed-then-deleted secret is found in history** while the working tree is clean, the command line exits 0, 1 and 2 as documented and never prints the value; and this repository's tracked files scan clean. **Failure-mode tests** use a stand-in `git` on `PATH` (non-zero exit with a planted secret on stderr, empty output, no commits), a repository with no tracked files, a directory that is not a repository, a shallow clone, a bad ref, an injected `EACCES` and `EIO` on one file, a tracked file missing from the working tree, and mistyped arguments, and assert exit status 2, the path and code in the message, and that no planted value appears anywhere in the output; deliberate exclusions (lockfile, over-size, binary, dangling symbolic link) are proven not to be errors. Fifteen mutation checks (six for detection: a rule removed, the value printed, expiry ignored, history scanning disabled, waiver path ignored, the 180-day cap ignored; nine for failure handling: git failure returning empty output, history exit status ignored, unreadable files skipped, no-commit history accepted, shallow clone accepted, unknown arguments accepted, git message echoed, empty file list accepted, spawn failure ignored) each fail the suite, except the last, which proved to be a redundant guard (a spawn failure also ends in a non-zero exit status that is already checked) and was removed rather than kept untested. A local scan of this repository's tree and history reported 0 findings after two placeholder cases were handled by improving the generic filter rather than by adding waivers.

## Not proven

Detection quality against real-world secrets beyond the listed formats, behaviour on a much larger history, and the review discipline for waivers. The workflow ran on GitHub for this pull request (green on `7a85f55`) but the hardened version has not yet run there. The weekly `--all` audit has been run only locally (above).
