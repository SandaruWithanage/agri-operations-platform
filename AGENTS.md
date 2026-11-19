# Codex instructions — Agricultural Operations Platform

Read `docs/PROJECT_CONTEXT.md` before proposing changes. Treat it as the current architectural and requirements baseline, **not** an approved final SRS. Resolve disagreements by recording an ADR; never invent client decisions.

Read the [Accepted data/state/cache ADR](docs/architecture/decisions/ADR-data-state-cache.md) before selecting or changing persistence, server-state, UI-state, caching or offline approaches. PostgreSQL/PostGIS owns authoritative data; TanStack Query owns online server state; Zustand is limited to shared UI state; Dexie owns durable offline work; Redis remains optional for confirmed needs. Follow the [roadmap](docs/development/ROADMAP.md), distinguish accepted architecture from implemented behavior, and propose an updated ADR for conflicts rather than silently replacing this decision.

## Living delivery documentation

Read [PROJECT_HANDOVER.md](docs/development/PROJECT_HANDOVER.md) before continuing implementation. It is the central delivered/pending task register and continuation plan. Whenever a pending task is completed or materially changes, update its stable task ID/status, what/how implemented, evidence, remaining limitations/dependencies and completion-log entry in the same PR. Split partially completed tasks rather than marking a whole domain done. Synchronize delivery status, roadmap, open decisions and setup/domain guides when their claims change. Preserve historical results as dated evidence. Keep engineering completion, CI results, provisional business rules and external client/device/production acceptance distinct; do not calculate completion percentages from tests, files or PR counts.

## UI development rules

Follow [UI_DEVELOPMENT_RULES.md](docs/development/UI_DEVELOPMENT_RULES.md): shared `@agri/ui` components first, one frosted-glass surface language with readable contrast and fallbacks, and every consequential action driven by a registered permission code. The interface is a convenience: PostgreSQL still decides, and a hidden button is never a security check.

## Working principles

- Work in a feature branch. Never push directly to `main`, force-push, or merge without approval.
- Inspect the repository and existing code before creating files. Make the smallest coherent change necessary.
- For significant work, explain the proposed approach and acceptance tests before implementing.
- Use version-controlled migrations for all PostgreSQL schema changes; do not apply draft reference SQL directly in production.
- Never store real farmer data, NICs, bank information, credentials, or production secrets in code, fixtures, prompts, logs, or commits.
- Keep PostgreSQL authoritative for access control and integrity; a hidden frontend button is not a security check.
- Enforce least privilege, row-level security (RLS), audited authorization changes, and fail-closed behavior when trusted actor context is missing.
- Use typed relational foreign keys for core entities. Optional project-specific survey fields may use versioned forms and JSONB with validation.
- Preserve and test offline behavior: local outbox, idempotent sync requests, version conflicts, and recovery from interrupted connectivity.
- Ensure user-facing field workflows support Sinhala and English, visible offline/sync states, readable contrast, and large touch targets.
- Treat land GPS points as identification only, not legal surveyed boundaries or verified acreage.
- Run formatting, type checks, tests, and builds as applicable, and report actual outcomes and limitations.

## Scope control

Current initial scope: monorepo foundation; IAM/ABAC and core database; farmer/land registration, officer responsibilities, project enrollments, simple GPS pins, resource records, and offline synchronization. Farmer self-service portal is Phase 2. Harvest procurement, transport, financial settlement, insurance, advanced surveying, and new project-type workflow engines are not approved Phase 1 features.

## Definition of done

A task is complete only when code, migration notes, tests, failure states, and README/developer instructions are present as needed; a PR summarizes what changed, what passed, and what remains unresolved.
