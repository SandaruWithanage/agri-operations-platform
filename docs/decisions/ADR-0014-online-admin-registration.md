# ADR 0014 — Bounded online administrator registration

Status: implemented technical approach for the provisional pilot rules; client acceptance remains outstanding. Supplements the accepted data/state/cache ADR and ADR 0013. No new business permission, data-retention policy or production approval is implied.

## Workflow and authority

The administrator application uses the existing administrator-source BFF, NestJS registration service and PostgreSQL registration function. The source, creator and timestamp come from trusted server context. Active `farmer.create` coverage remains database-configured and rechecked at submission. A coordinator label, cached option or registration alone grants no right to read, correct or verify existing records.

The form collects only full name in either language, a configured authorized geography and confirmation that the required privacy notice was provided. It generates a farmer UUID and one mutation UUID. Phone, NIC, address, birth date, land, documents, CBO and projects are not collected by this minimal form and are never required. The existing service creates Pending Review records, records duplicate risk without merging, and audits registration. It assigns no permanent officer owner or project enrollment.

## State, locking and retries

The shared UI package supplies a pure bilingual core form. Each application owns its identity, authorization, submission and persistence adapters. Moving the field form does not change its encrypted Dexie outbox or restart behavior.

Admin registration is online-only. TanStack Query owns current create-reference reads and mutation state, with an isolated account/device/epoch-bound client, no persistence, no automatic retry and `networkMode: always`. Component memory holds incomplete values and a fixed submitted request; neither enters Zustand, IndexedDB, URLs or localStorage. The application permits only one registration or correction draft at a time.

Hiding, navigation, sign-out, transport changes, denial or five minutes of inactivity removes form values from the DOM, cancels reads and clears fetched/mutation caches. Values remain locked in tab memory, which is not a claim of heap erasure. Reopening checks the original authenticated account/device and current create references. A selected geography that has lost coverage prevents reopening. The server independently rechecks current permission for each retry.

After a valid first attempt the entity ID, mutation ID and payload are immutable. A lost acknowledgement allows an explicit identical retry. Reconnection never submits automatically. Late replies after locking cannot erase the retained request or report success. Conflicts retain the request without overwriting records. Success clears the draft and refreshes the registry; it does not display the submitted data as a substitute for an authorized read.

Discard requires a fresh original-account/device identity check and explicit confirmation. The notice states that discarding cannot cancel a committed or still-running server request. Review an uncertain registration with an authorized administrator before creating another record.

## Recovery limits and remaining decisions

Unsent admin work and retained request IDs do not survive tab reload, browser termination or a crash. An initial notice and before-unload guard reduce accidental loss but cannot guarantee recovery. Durable administrator draft storage and a separate registration-outcome discovery endpoint remain follow-up work; the encrypted field workspace remains the durable offline registration route. Do not infer that a missing record in a create-only account proves submission failure.

Client approval of privacy-notice wording, broader configurable fields, duplicate-review procedures, native-speaker review and production/device acceptance remains outstanding. This adds no migration or expanded offline dataset.
