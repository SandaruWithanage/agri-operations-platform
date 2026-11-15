# Online staff verification

Apply native migration **15** before deploying this API/UI revision, using the existing controlled migration identity and nine restricted runtime connections. It adds a partial journal index and restricted receipt function; it seeds no business permissions, changes no farmer values/history and requires no new environment variable or LOGIN role. As with other transaction-based migrations, schedule/rehearse index creation for the deployed data volume.

Grant current scoped `farmer.read` plus `farmer.verify` through the controlled IAM process. Read/create/correct/audit permissions alone do not grant verification. Follow [runtime provisioning](PILOT_AUTH_RUNTIME.md), [registry setup](FARMER_REGISTRY.md) and [ADR-0012](../decisions/ADR-0012-online-staff-verification-ui.md). All criteria remain provisional staff review of the minimal record, not legal identity/title/project evidence.

## Workflow

1. Sign in with the normal MFA/approved-device flow and open a farmer record.
2. If currently allowed and Pending Review, inspect the name, configured location and any possible-duplicate warning. Explicitly confirm staff review, then choose Confirm record review. English/Sinhala labels are supported; entered names and configured labels remain unchanged.
3. The existing versioned API atomically updates status/version and writes its audit journal. The UI reloads authoritative detail after acknowledgement; it does not set Verified optimistically.
4. On uncertain connectivity, keep the view open and use Retry the same verification. The intent UUID, version and fixed audit reason stay unchanged. A stale/state conflict requires Refresh record and explicit review. Permission/session failures clear the protected parent view.
5. If the page was closed or hidden before the result was known, reopen the current authorized record and choose Check my latest verification receipt. The receipt belongs to the current account and shows resulting version/time, not a claim about later record changes. Refresh the record before any further action. No mutation is sent automatically by reopening or receipt lookup.

There are no correction fields or free-text notes in this step. Pending/uncertain actions have an unload warning and a visible explanation of server recovery. Only transient intent metadata resides in memory, and no admin farmer/verification data is persisted locally. Unsynchronized field drafts are unaffected.

## Receipt protocol

`GET /api/pilot/farmers/verification-receipt?id=<uuid>` accepts only one ID. Responses are no-store and have `{ accountId, farmerId, receipt }`, where receipt is null or `{ mutationId, version, occurredAt }`. The timestamp retains database microseconds. A null response means no own receipt is visible under current permissions; it exposes no hidden totals.

NestJS checks current read/verification permission and the restricted native function independently checks signed actor/session and geography coverage. It includes only the actor's own verification action, not another actor's action or a correction. Current and historical/result geography permissions are all required. Runtime logins still cannot query the journal directly. The typed BFF/browser boundary strips extras and binds the response to the requested farmer; the UI also binds account identity.

Use `PilotClient.farmerVerificationReceipt(id, signal)` for this read. The write remains `PilotClient.changeFarmer(accountId, frozenPayload)` with fresh CSRF/account checks. No JWTs or session secrets enter the browser. TanStack Query owns network/loading/error/mutation state; the shared Zustand locale store and Dexie outbox keep their existing responsibilities.

## Verification and unfinished work

Run frozen install, format, lint, typecheck, full tests, production builds and both Chromium journeys against a fresh disposable PostGIS test database. Tests cover explicit confirmation, exact retry, stale/revoked requests, late completion/cache clearing, language transitions, own receipt isolation and reopening after a committed write with a lost response. Live native tests verify no journal grants or scope leakage and preserved existing records through migration.

A safe correction editor, broader lifecycle/reassignment, client verification/evidence decisions, review separation and audit retention/redaction remain unfinished. No deployment or pilot-device acceptance follows from these automated checks.
