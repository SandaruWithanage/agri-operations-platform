# First Codex task

Open repository `SandaruWithanage/agri-operations-platform`. Read root `AGENTS.md` and `docs/PROJECT_CONTEXT.md`, inspect actual code, and begin **Milestone M0 only**.

1. Report existing repository state, tool versions and any conflict with the handoff.
2. Plan monorepo foundation (pnpm + Turborepo, Next.js admin and field PWA, NestJS API, PostgreSQL/PostGIS Docker, shared i18n/UI packages, basic CI).
3. Implement on `chore/m0-foundation` (or a clearly named feature branch). Do not touch production systems or commit secrets.
4. Execute dependency installation, lint/typecheck/test/build and document what passed or couldn't run.
5. Open a PR against `main` and stop for review; do not merge.

Keep ABAC/RLS and full DB schema as **M1**. Build only the minimum DB/dev foundations in M0, not production authentication, migrations, procurement, finance, or farmer portal.
