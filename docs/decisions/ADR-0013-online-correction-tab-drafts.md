# ADR-0013 — Bounded online farmer correction and locked tab drafts

Status: provisional implementation defaults under ADR-0009 and the accepted data/state/cache architecture. These are not client-approved evidence, reviewer-separation, retention or lifecycle rules.

## Scope

The administrative application exposes name and configured-geography correction only after the server's `access.correct` hint. Fresh session identity, record reads and bounded location choices are checked before displaying the form. The hint never authorizes submission: the existing NestJS and native PostgreSQL change protocol repeats current session, read/correct source and destination coverage, expected-version and idempotency checks.

Names remain 1–200 trimmed characters. The UI requires explicit review and uses a fixed locale-independent reason, `Staff corrected the displayed farmer name and configured geography after review.` A correction to a Verified record returns it to Pending Review; an Inactive record stays Inactive. No identity documents, project enrollment, account access, officer ownership or role/assignment changes are introduced.

## Working values and privacy

Editable values live only in the mounted correction component's tab memory. This is an online form, not durable offline work. English/Sinhala changes preserve them. The initial notice and dirty/submitted before-unload guard explain that closing/reloading/crashing can lose unsent changes. Browser/OS termination can bypass the warning. The encrypted Dexie field registration workspace remains the durable offline workflow; no correction store, queue, query persister or additional browser dataset is added.

On hiding, registry navigation, logout, transport changes, denied reads or five minutes of inactivity, the form removes private values from the DOM, cancels protected reads and clears its query/mutation caches. Minimal unsent values and any fixed submission remain in locked local form memory to avoid silent loss. They are deliberately not claimed to be cryptographically erased from the browser heap. No business records enter Zustand, locale storage or page URLs.

A draft remains bound to its original account, approved device, farmer and transport. Reopening requires a fresh authenticated account/device read and current record/location reads. When the record has moved, the form also proves current read/correct eligibility for the original configured location using a bounded authorized page immediately before its UUID. It never restores old-location values based solely on permission for the new location. Mismatched account, device, reply version/location or revoked coverage locks the form without deleting its values. An inactive old location may prevent that eligibility proof; the conservative result is a locked retained draft, not disclosure through a broader current scope.

Explicit discard rechecks the original account/device and requires confirmation before removing working values. Discard is local form cleanup, not deletion of a farmer and not cancellation of a server request. A device/account that cannot authenticate cannot use this control to clear another account's retained draft. Closing the browser remains a separate data-loss risk described by the notice.

## Submission and recovery

TanStack Query owns fetched server data and online mutation status. At submission, the reviewed values, original version, reason and a single generated mutation UUID are fixed. Frontend/device checks are safety bindings only; server sessions and database permissions remain authoritative. No optimistic record update, automatic retry, rebase or replacement mutation occurs.

A version conflict retains the fixed values for review and requires a fresh record before a new correction. An uncertain response may be retried with the identical submission, including after locking and reauthorization. If the first request already committed, the existing database journal returns the original acknowledgement once current permissions pass. A late acknowledgement cannot reopen a cleared view or erase its locked draft. Own correction receipts provide a separate bounded server-outcome check; a missing receipt never proves failure. Discarding a retained request cannot undo an accepted correction.

On an authoritative success, working values and protected mutation/query state are cleared and the administrative application fetches the farmer detail again using a fresh session context. The current record may already include later changes; the receipt version is not treated as its present state.

## Limits

Tab-crash/reload recovery of unsent online corrections is not implemented. The field's encrypted incomplete drafts, stable registration IDs, pending mutations and recovery archives remain unchanged. Full lifecycle/reassignment, optional sensitive fields, client review criteria, audit retention, key rotation, actual device security, native-speaker and production acceptance remain unfinished. See [setup and verification](../development/FARMER_CORRECTION_EDITOR.md).
