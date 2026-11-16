# ADR 0016 — Configurable organization-wide project catalog

Status: provisional technical implementation. This is a catalog foundation, not client-approved enrollment rules, a project-type workflow engine or production acceptance.

## Scope

Projects have a generated UUID, configured organization FK, name, catalog-enabled flag, version and trusted creator/time. No crop names, project codes, organizational zones or business roles are seeded or hardcoded. Names may be entered in English or Sinhala and are not translated. Duplicate names are allowed; UUIDs identify records. Type-specific forms, project codes, cultivation cycles and configurable relationships remain separate design work.

The technical catalog flag defaults to disabled unless explicitly selected at creation. It is metadata, not authorization or an enrollment decision. This provisional default needs client review. Creating an enabled catalog entry starts no workflow. Creation/read are implemented; rename, later enable/disable changes and lifecycle management require explicit versioned follow-up operations. No delete endpoint is introduced.

## Authority and tenancy

Native migration 19 creates `operations.project`, a private mutation journal and audit, FORCE RLS and fixed security-definer functions. The application uses a tenth independent restricted identity inheriting only `agri_project_runtime`. The NOLOGIN function owner is never a business role or application LOGIN.

This first catalog requires explicit organization-wide `project.create` grants with trusted source `administrator`, and separate organization-wide `project.read` grants with null source. Both require null geography and unit constraints. Assigned, geography-limited, unit-limited, wrong-source, expired, future or inactive grants cannot widen to organization-wide catalog access. Farmer, land and audit grants confer no project access. No registering-officer ownership is inferred.

The organization in a request is a target, never a trusted scope. NestJS and PostgreSQL independently check current authority for it. Organization choices disclose only configured names within create authority. Read RLS exposes only authorized organizations, no totals; hidden and nonexistent details return the same unavailable response. Direct runtime writes, journal/creator/key reads and owner-role assumption are denied. Runtime startup also rejects project-owner membership, project-journal column grants and missing project connection configuration.

The organization/grant rows and authenticated actor are locked and checked for the transaction. Permission validity is rechecked after waiting, preventing an expired or revoked grant from authorizing a waiting write. Current actor/session/account/device checks retain the existing signed transaction-context boundary. No JWT role claim grants authority.

Project-specific/combined geography-plus-project assignments are **not implemented** by this catalog. Narrow grants deliberately fail closed. Future enrollment/assignment operations need typed relationships, their own scope intersection checks, negative tests and audit; they must not reinterpret catalog read as access to farmers or land.

## Submission, state and recovery

The BFF validates strict bodies and CSRF, fixes the application source and retains JWT/session secrets server-side. UUIDs are canonicalized. A valid submission fixes its project UUID, mutation UUID and normalized payload. The native actor-bound MAC journal makes exact/concurrent retries idempotent and rejects changed requests. Project, journal and audit write atomically. The existing context-key/MAC retention and rotation limitation remains production work.

The admin UI uses isolated TanStack Query reads/mutation state and the shared tab-only creation controls. Organization selection is a domain adapter, not a geography masquerading as an organization. Only one registration/correction/land/project draft is open at a time. Protected navigation/hiding/logout/inactivity/denial clears fetched state, hides private values and retains locked local work. Original account/device and current selected-organization create access are required to reopen it. Success refreshes authorized catalog data, rather than treating submitted values as a read grant. Reconnection never submits automatically. Explicit discard checks identity and warns that a committed or still-running request cannot be undone.

No project dataset or retry queue is added to Dexie, localStorage, Zustand, URLs or public HTTP caches. Tab/browser termination may lose unsent values and request IDs despite the warning and leave-page guard. Durable online recovery, project offline storage, native-speaker/device testing and production operations remain unfinished.
