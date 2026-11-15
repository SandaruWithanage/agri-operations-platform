# Codex continuation entry

M0 is complete. Before continuing current authorized work, read:

1. [Root AGENTS.md](../AGENTS.md).
2. [Project context](PROJECT_CONTEXT.md).
3. [Accepted data/state/cache ADR](architecture/decisions/ADR-data-state-cache.md).
4. [Current roadmap](development/ROADMAP.md), [delivery status/backlog](development/PHASE_1_STATUS.md) and relevant domain/security ADRs.

Inspect the repository and current branch/PR state before making changes. Accepted architecture is not the same as implemented behavior or production acceptance. Follow the current user-authorized scope and feature-branch process. The original M0 brief below is historical; do not restart M0 or treat its milestone boundary as today's backlog.

## Historical first M0 brief

Open repository `SandaruWithanage/agri-operations-platform`. Read root `AGENTS.md` and `docs/PROJECT_CONTEXT.md`, inspect actual code, and begin **Milestone M0 only**.

1. Report existing repository state, tool versions and any conflict with the handoff.
2. Plan monorepo foundation (pnpm + Turborepo, Next.js admin and field PWA, NestJS API, PostgreSQL/PostGIS Docker, shared i18n/UI packages, basic CI).
3. Implement on `chore/m0-foundation` (or a clearly named feature branch). Do not touch production systems or commit secrets.
4. Execute dependency installation, lint/typecheck/test/build and document what passed or couldn't run.
5. Open a PR against `main` and stop for review; do not merge.

Keep ABAC/RLS and full DB schema as **M1**. Build only the minimum DB/dev foundations in M0, not production authentication, migrations, procurement, finance, or farmer portal.
