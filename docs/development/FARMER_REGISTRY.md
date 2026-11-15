# Scoped farmer registry

The admin application now provides a minimal English/Sinhala farmer list/detail workflow. A separately authorized [bounded staff verification action](FARMER_VERIFICATION.md) uses the [versioned review/correction API](FARMER_REVIEW_API.md). Correction editing, reassignment and sensitive optional fields remain unfinished. [Audit history](FARMER_AUDIT_HISTORY.md) requires a separate permission.

## Setup

1. Follow [pilot authentication setup](PILOT_AUTH_RUNTIME.md) and [device enrollment](DEVICE_ENROLLMENT.md). Provision a distinct approved browser/device for the admin HTTPS origin; a field-origin key is not copied to the admin origin.
2. Apply native migrations using the controlled migration identity and the independent database-name check. The eleventh manifest entry adds `farm.farmer_geography_name(uuid)`. It reveals a configured label only when the current signed actor has `farmer.read` access. It grants no direct geography-table access and changes no existing farmer data.
3. Configure `apps/admin-web/.env.local` with its server-only `PILOT_API_ORIGIN`, exact HTTPS `PILOT_PUBLIC_ORIGIN` and matching `PILOT_INTERNAL_KEY`. Keep real keys outside Git. Use the actual runtime environment/secret manager for deployment.
4. Provision explicit database-configured `farmer.read` grants and active assignments under the existing IAM rules. A position, frontend URL, registering-officer identity or `farmer.create` grant alone does not grant read access. Organization-wide access still requires the configured organization grant; do not create illustrative roles/scopes in production.
5. Run `pnpm dev`, or the documented individual app commands. The API dev script builds the shared validation CommonJS runtime first. Rebuild that package and restart the API when changing shared contracts; the API's ordinary source watcher does not reload shared dependency modules automatically.

## Access and data flow

The admin origin uses its own opaque Secure/HttpOnly/SameSite session cookie and the same approved-device/MFA login protocol. The Next.js BFF obtains a short-lived server-only JWT, validates bounded query parameters and sanitizes the read response. NestJS derives the actor from the verified session. The registry service runs an explicit `farmer.read` predicate inside signed transaction context, with FORCE RLS independently enforcing the table boundary.

List requests use bounded UUID keyset pagination (1–100 rows, default 25). The UI requests 25 rows; Back/Next and a refresh are available. No organization-wide total or hidden-row count is returned. Refresh to see newly inserted records that sort before the current cursor. An unavailable ID and a nonexistent ID produce the same 404 response. Out-of-coverage names/locations/IDs do not appear in results or cursors.

Responses include the trusted request actor's account ID so a changed browser session cannot be shown under an earlier account context. The screen clears old data before another read, on a failed request, sign-out or hiding; a late response cannot repopulate a cleared view. A successful prior view is not server authorization for another request. Farmer data is kept only in memory, with no admin service worker or farmer IndexedDB/localStorage cache. Locale preference and the device authentication infrastructure are separate.

## Review queue

The [scoped review queue](FARMER_REVIEW_QUEUE.md) adds status and current verification-eligibility filtering, bounded cursor pages and shareable enum-only view selections. Apply index migration 16. It grants no verification rights and returns no hidden/global totals.

## Shared protocol runtime

Browser/BFF bundles consume `@agri/validation` TypeScript sources. NestJS consumes its generated CommonJS build through the package's `require` export. Turborepo builds the shared package before the API; production artifacts must include that generated `dist` directory. The browser smoke test also starts the compiled API and checks health, verifying actual runtime module loading rather than compilation alone.

## Verification and limits

Run the standard lint, format, typecheck, test and build commands with a disposable PostgreSQL 17 `agri_test` database, then `pnpm test:browser`. The live NestJS/BFF/database test proves create/read separation, scoped label lookup, disjoint keyset pages, hidden-record non-disclosure and immediate next-request denial after read-grant revocation. Component tests cover actor mismatches, late-response cleanup, both languages and login-secret clearing. Chromium checks compiled API startup and the admin list/detail/pagination/session-cleanup flow with synthetic HTTP adapters.

This does not establish production acceptance. Privileged account/permission administration, full farmer review/correction, operational security, native-speaker/accessibility checks and actual hosting/device acceptance remain release work.
