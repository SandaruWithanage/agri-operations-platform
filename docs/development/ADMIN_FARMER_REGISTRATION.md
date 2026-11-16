# Administrator farmer registration

The admin app now offers **Register a farmer** after authenticated session loading. Sign in with an approved account/device through the configured HTTPS administrator BFF. Follow [pilot runtime setup](PILOT_AUTH_RUNTIME.md) and apply the existing native migration manifest through entry 18. No new environment variable, migration or default role is introduced.

The button starts an access check, not a permission grant. Configured active `farmer.create` permissions for registration source `administrator` determine the available locations. NestJS and PostgreSQL revalidate permission on every submission. Creation does not require existing farmer-read access; a create-only administrator can submit even when the registry is unavailable. It does not gain read, correction, verification or audit authority from creating a farmer.

1. Select **Register a farmer**, enter a full name in English or Sinhala and choose an authorized configured GN division/village.
2. Confirm the required privacy notice was provided. This is a record of notice delivery, not an invented consent or legal approval. The client must still approve the actual notice and collection rules.
3. Save. The existing service records trusted source/creator/time, assigns Pending Review status and flags available exact-name/location duplicate risk without automatic merging. This minimal form collects no optional contact, identity, land, document or project data and assigns no permanent owner.
4. If the result is uncertain, keep the tab open and explicitly retry the same fixed request. No automatic reconnect submission occurs. A conflict preserves the request for review. After success, the registry reloads with current read permissions rather than displaying the submitted payload as an authorized record.

English/Sinhala switching preserves form values. Hiding, changing views, sign-out, transport changes, denied access or five minutes of inactivity locks the form. Reopening requires the original account/device and current create coverage for the selected location. A different account cannot reveal or discard the draft. One open registration/correction cannot silently replace another.

**Admin values are held only in this tab.** The initial notice and leave-page warning do not prevent loss on browser crash, reload or termination. Use the encrypted field workspace for durable offline registration. Explicit discard requires original-account/device checking and confirmation, warns about uncertain server outcomes and cannot undo an accepted request. Do not register the same farmer again solely because a create-only account cannot read a record. See [provisional technical decisions and recovery limits](../decisions/ADR-0014-online-admin-registration.md).

The shared `@agri/ui/farmer-registration` form has no identity, permissions or storage. The field workspace retains its existing Dexie adapter and safe replay/restart behavior; the admin adapter owns isolated online query/mutation state and tab-only values. No second outbox or sensitive query-cache persistence is installed.

Run the normal install, peer/audit, lint, formatting, type-check, synthetic PostgreSQL tests, production builds and Chromium checks documented in the README. See [verification evidence](../testing/ADMIN_REGISTRATION_RESULTS.md). Passing automated checks does not establish legal, native-speaker, device or production acceptance.
