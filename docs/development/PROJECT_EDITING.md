# Versioned project catalog editing

After sign-in, choose **Projects → View project → Edit catalog project**. The action appears only when the current detail response indicates editing authority. Enter a changed name or toggle the catalog-enabled flag, review the values, confirm and save. English/Sinhala switching preserves the working values. This flag is catalog metadata, not enrollment, operational closure or access permission.

## Upgrade and permissions

Apply native manifest entry **20**, `20261116_project_lifecycle/up.sql`, through the tracked migration runner before deploying the endpoint. It extends the fixed organization-permission helper, adds restricted edit policies, a private change journal and version-linked audit. Existing project rows and creation audit fields/timestamps remain unchanged. Creation audit gains version 1 and a null change reference.

The ten existing restricted runtime connections remain in use. No new LOGIN, environment setting, secret or business grant is installed. Through controlled IAM provisioning, configure both current organization-wide `project.read` with null source and `project.update` with administrator source. Geography/unit constraints must be null; assigned/narrow, inactive, wrong-source and expired grants cannot widen access. Creation permission alone does not permit editing. NestJS and PostgreSQL enforce these checks regardless of the button/cached capability.

Enabled startup requires execution of the migration's fixed edit function by the project runtime. A missing function or execute grant fails startup rather than advertising the editing runtime as ready. Apply migration 20 before deploying the enabled API.

## Behavior and protocol

`POST /api/pilot/projects/change` accepts exactly `mutationId`, `projectId`, positive `expectedVersion` below 2,147,483,647, `name` and explicit boolean `active`. IDs are canonicalized. Name/flag are a complete reviewed edit, not an implicit partial patch. Organization, creator, creation time, roles and enrollment claims are rejected. The trusted administrator BFF supplies source/session/CSRF context; `PilotClient.changeProject` additionally binds the retained request to its original authenticated account/device.

The record must still match the original reviewed version. A successful change advances it once, preserves creator/time/organization and writes old/new metadata and audit atomically. A no-op or invalid request is rejected. Identical concurrent retries create one change; competing requests against the same version produce a conflict. A later edit never changes an earlier retry's acknowledgement version. The app reloads current authorized detail rather than treating the acknowledgement as the present record.

The editor holds one fixed submission after the first attempt. If the response is uncertain, keep the tab open and retry it unchanged. There is no automatic reconnect retry, overwrite, rebase or replacement mutation. A conflict retains values for explicit review; to start a new edit, explicitly discard and open a fresh record. Discard cannot undo an accepted or still-running request.

Navigation, hiding, sign-out, connection changes, denied access or five minutes of inactivity locks the editor. Reopening needs the original account/approved device and current read/update authority for the original project organization. It does not reset the original version. If an organization has moved through privileged maintenance, values stay locked rather than following it into another scope.

**Working edits and retained IDs are tab-only.** No project data is saved to Dexie, localStorage, Zustand, URLs or public HTTP caches. Closing/reloading/crashing can lose work despite the notice and leave-page guard. Review uncertain outcomes with an authorized administrator before another submission. Durable online recovery and a separate own-edit receipt endpoint remain unfinished.

Run the normal install/audit/peer, lint/format/type, disposable PostgreSQL/PostGIS, production build and Chromium checks. See [verification evidence](../testing/PROJECT_EDITING_RESULTS.md) and [ADR 0017](../decisions/ADR-0017-versioned-project-editing.md). Farmer enrollment, assignment policy, lifecycle/closure rules and production/native-speaker/device acceptance remain separate work.
