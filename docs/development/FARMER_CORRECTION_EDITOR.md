# Bilingual online farmer correction

The admin farmer detail view now offers **Correct record** when the current server capability permits it. The bounded form changes only full name and configured location, requires explicit review, and uses the existing versioned/idempotent correction API. Apply the existing native manifest through entry 18 and follow [pilot runtime setup](PILOT_AUTH_RUNTIME.md); this UI change adds no migration, role, environment variable or business grant.

The server needs explicit `farmer.read` and `farmer.correct` coverage for the current/source and selected destination locations. Creation, verification or audit permission alone grants no correction authority. Approved accounts/devices, session/CSRF protection and database RLS remain required. No frontend role names, zones, project membership or registering-officer ownership are inferred.

## Operator flow

1. Sign in through the configured HTTPS BFF, open an authorized farmer and choose **Correct record**.
2. The form checks fresh account/device identity and current record/location access. Edit the name and select an active authorized location. Location pages are bounded; use first/more/selected-location controls without hidden totals. Entered names and official location labels are not translated.
3. Review the values and possible-duplicate warning, then confirm and save. The immutable request keeps its original version and a stable mutation UUID. Verified records return to Pending Review; inactive records stay inactive.
4. Success fetches the authoritative farmer detail again. A conflict never overwrites current data. An uncertain outcome supports only the same retained request; check an own correction receipt and a fresh record before deciding on another action.

Changing application views, hiding, logout, transport changes, read denial or five minutes of inactivity locks the form and clears fetched records/mutation caches. The working values stay in this tab's local form memory, outside the cleared online cache. The locked UI exposes no names or selected values. Reopen only after original-account/device and source-coverage checks succeed. When a record moves, old-location eligibility must also be proved; access to its current location alone cannot disclose the old draft.

**This is not an offline correction queue.** There is no browser persistence, automatic submission or second durable outbox. Reloading, closing or browser/OS termination can lose unsent values despite the notice and before-unload guard. Use the field workspace for durable offline farmer registration. Explicit local discard requires current original account/device identity and confirmation, and does not undo a request already committed by the server.

## Implementation and boundaries

`PilotClient.sessionIdentity(signal)` returns only authenticated account/device metadata and consumes a cancellable session read; CSRF data is not returned to query consumers. The editor does not fetch registration reference catalogs just to establish identity. `changeFarmer` optionally binds a retained submission to its expected device before forwarding it; actual authorization still comes from the BFF/NestJS/PostgreSQL session.

The form has its own ephemeral protected query client, with account/device, draft source, view epoch and page identities. It cancels and clears reads on protected transitions, ignores late acknowledgements, and retains only local working values/immutable retry input. Registry and draft sibling keys have distinct prefixes so a fresh page's first registry and first draft cannot collide during locale changes. One open draft cannot be silently replaced by another.

Source/version mismatches between current-record and choice responses fail closed. A moved record needs a separately eligible original-location page. An inactive original location may prevent that proof; values remain locked until access can be established or the original account/device explicitly discards them. The application does not invent broader history rights to recover the view.

Run the documented checks with a disposable synthetic `agri_test` PostgreSQL/PostGIS service and `pnpm test:browser` after production builds. Component tests cover retained values, locale, inactivity, account/device/transport isolation, revoked coverage, conflicts, exact retry, explicit discard and late responses. The browser flow covers navigation/locale preservation, a lost acknowledgement, an identical retry and fresh authoritative detail. Native permission/idempotency/audit checks remain in the full database suite.

The [technical defaults and recovery limits](../decisions/ADR-0013-online-correction-tab-drafts.md) remain provisional. No native-speaker, real-device or production acceptance is implied by automated checks.
