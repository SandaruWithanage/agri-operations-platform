# Session resume point

**Purpose:** where work stood when a session paused, so the next session (or a scheduled resume) continues without re-deriving it. Read [AGENTS.md](../../AGENTS.md) first. This file grants **no approval**: merges, privileged changes and production-affecting security changes need the owner's own explicit approval, and every head and CI state below must be re-checked before acting.

**Last updated:** 19 Nov 2026. **Never store a secret, key, token or personal data here.**

## Open pull requests (re-check the head and CI before acting)

| PR   | Subject                                                      | Last head seen | State and what it needs                                                                |
| ---- | ------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------- |
| #112 | SEC-A9 CI secret scanning, hardened after owner review       | `cc8a427`      | CI green. **Needs the owner's separate merge approval** (production-affecting).        |
| #114 | SEC-A2 hash-key production requirement (docs)                | `0dc6d05`      | Docs only; normal review.                                                              |
| #115 | SEC-A3 provider-neutral edge and origin ADR (PROPOSED, docs) | `815a400`      | Docs only; normal review.                                                              |
| #116 | GoviAxis product name in UI, titles and docs                 | `6dc436e`      | CI green. **Needs the owner's merge approval** (changes the interface).                |
| #117 | Stitch MCP declaration in `.mcp.json` (no key)               | `41695db`      | Config only; needs `STITCH_API_KEY` set by the owner in the environment settings.      |
| #118 | Stitch UI/UX review (docs)                                   | `fd78ac8`      | CI green after one transient Chromium-install failure on an older head; normal review. |

Already merged on owner approval: #108, #109, #110, #111 (SEC-A2, squash `efaa7a6`).

## Next steps, in order

1. SEC-A4 request-budget design (design-only): route inventory, one budget per route class, concurrency limits, protections for the capabilities endpoint.
2. SEC-A5 progressive login protection design on decision D3 option B (design only).
3. Benchmark PostgreSQL authorization and query limits on a disposable stack before any SEC-A6 migration.
4. Stitch-based UI changes listed in `STITCH_UI_UX_REVIEW.md`, each a small reviewed PR, after the owner's decisions there.

## Do not

- Merge anything without the owner's explicit approval; green CI alone is never authorization.
- Start privileged IAM schema changes, capabilities C1, C2 or C3, or any deployment needing unresolved approval.
- Record DEC-02 Q1 to Q12 as confirmed without the owner's word "confirm".
- Claim Gate G1, independent review or production security acceptance is complete.
- Use or store the Stitch key that was pasted into a chat; it is exposed and must be rotated.

## Open owner items

Sign-in flow choice (single form or two steps), approved organisation naming, scope of loan, harvest, survey and import/export screens, bulk-export permission, native-speaker review of Sinhala text, an independent AppSec and PostgreSQL reviewer, hosting (OPS-04), incident and alert ownership, deleting or waiving the merged `claude/sec-a2-security-events` branch finding in the weekly secret scan, and the next session start time for scheduled resumes.
