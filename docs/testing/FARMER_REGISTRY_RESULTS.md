# Farmer registry verification — 15 November 2026

All fixtures are synthetic. This is a minimal scoped read workflow, not production certification or a completed farmer administration module.

- Frozen-lockfile installation, formatting, ESLint, workspace type checks and production builds passed.
- 150 unit/integration tests passed with disposable PostgreSQL 17. The eleventh native migration is included in the tested manifest and applied after the existing authentication/ABAC/device migrations.
- The live NestJS/BFF/PostgreSQL request flow proves creation-only access returns no existing records; a separate read grant enables scoped reads; direct restricted-role label lookup returns no unauthorized label; keyset pages contain no duplicates or hidden IDs/names/locations; unavailable and nonexistent details share a 404; invalid/untrusted scope parameters are rejected; revoking the read grant denies the next request.
- BFF tests verify no-store sanitized output, bounded/whitelisted queries, duplicate-parameter rejection and non-disclosing detail failures.
- Five admin component tests cover English/Sinhala rendering, no farmer persistence, actor mismatch denial, rejected-request cleanup, late-response suppression on hiding and failed-login password/OTP clearing.
- The combined Chromium suite passed field offline restart/archive recovery and admin list/detail/pagination, language switching, scope/session rejection cleanup and no admin farmer IndexedDB/localStorage persistence. It also starts the compiled CommonJS API and verifies health plus disabled-runtime denial. Browser HTTP adapters are synthetic; the separate database test verifies authoritative access.

Remaining work includes farmer correction/verification/reassignment, separate sensitive-field handling, privileged administration, land/GPS and other Phase 1 domains, deployment/security/operational checks and actual device/Sinhala/accessibility acceptance. See [registry setup](../development/FARMER_REGISTRY.md) and [delivery status](../development/PHASE_1_STATUS.md).
