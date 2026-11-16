# Configurable project catalog

The admin app provides **Projects** list/detail and **Create catalog project**, in English/Sinhala. The catalog also supports [versioned name/flag editing](PROJECT_EDITING.md) after migration 20 with separate read/update authority. Enrollment, officer assignment, project types/cycles, resource accounting and client-approved operational lifecycle rules remain future work. Farmer registration does not enroll a farmer automatically.

## Upgrade and provisioning

1. Rehearse/apply manifest entry **19**, `20261116_project_catalog/up.sql`, through the controlled native migration runner. Existing farmer/land rows and prior migration checksums are unchanged. The runner also refuses untracked `operations` schemas.
2. Provision a separate LOGIN inheriting **only `agri_project_runtime`** and add its URL to `PILOT_DATABASE_URLS`. The enabled API now requires ten separated runtime connections; older nine-connection configuration fails startup. The project login cannot inherit `agri_project_function_owner`, a migration identity or another runtime group. Production URLs require verified TLS.
3. Through the controlled IAM provisioning process, configure explicit grants in `authz.permission_grant`. `project.create` requires coverage `organization`, the selected organization, source `administrator`, null geography/unit, active status and a valid time interval. `project.read` requires the same organization-wide shape with a **null** source. No grant, role, organization or project is automatically seeded. Use secure credential provisioning; never paste credentials into SQL files or shell history.
4. Deploy the API/BFF/admin app after migration and the tenth LOGIN are ready. Follow [runtime setup](PILOT_AUTH_RUNTIME.md). No additional application secret or browser token storage is introduced.

## Use

Sign in with an approved account/device, choose **Projects**, and inspect the catalog within current read permissions. Pagination uses UUID cursors without hidden totals. Open a project to view its configured organization, entered name, flag and creation time. Source names are not translated on language switching.

For creation, choose an authorized organization and enter a name. The **Enabled in catalog** flag defaults off; explicitly enabling it grants no permissions and launches no workflow. UUIDs identify projects; duplicate names are not silently merged. The server derives creator/session/time and writes audit with the project. The new record is not automatically shown to a create-only user.

An uncertain outcome can be retried using the same fixed request. A changed payload conflicts; it never overwrites a project. Hiding, navigation, logout, transport changes, denial or five minutes of inactivity locks the tab draft. Reopen with the original authenticated account/device and current organization-wide create coverage. Explicit discard warns that it cannot undo an accepted or running server request. Keep the tab open until acknowledgement: browser termination/reload can lose work and retained IDs. There is no project offline queue or durable tab recovery.

## Protocol and boundaries

- `GET /api/pilot/projects?limit=25&after=<uuid>`: bounded authorized list, maximum 100 items per page; no caller-supplied organization/account/role scope.
- `GET /api/pilot/projects/detail?id=<uuid>`: authorized detail; hidden/missing both unavailable. Current edit capability is a source/grant hint, never authorization.
- `GET /api/pilot/projects/organizations`: filtered configured organization choices for creation, maximum 10,000. A larger response fails validation rather than silently truncating; pagination is needed before such a deployment.
- `POST /api/pilot/projects/register`: `mutationId`, `projectId`, `organizationId`, `name`, optional boolean `active` (default false). Caller source, actor, roles, project type, farmer/land/enrollment IDs and creator/time fields are rejected.

`PilotClient` supplies `projects`, `project`, `projectOrganizations`, device-bound `registerProject` and versioned `changeProject`. Read methods accept abort signals; submission rechecks the authenticated account/device. NestJS and native SQL remain authoritative for current permissions. Project metadata does not grant access to people, land or future enrollments. Narrow project/geography assignments are not implemented and cannot become organization-wide access.

Run installation, peer/audit, lint, format/type checks, synthetic PostgreSQL tests, production builds and Chromium checks. See [verification evidence](../testing/PROJECT_CATALOG_RESULTS.md) and [ADR 0016](../decisions/ADR-0016-project-catalog.md). No client, native-speaker, physical-device or production certification is claimed.
