# Authorized farmer correction locations

The online correction API now has a bounded location-choice read:
`GET /pilot/farmers/correction-geographies?id=<farmer UUID>&limit=50&after=<optional geography UUID>`.
The same-origin browser route is under `/api/pilot/`. `PilotClient.farmerCorrectionGeographies` validates and sanitizes replies, supports cancellation and requests 50 choices per page. This prepares the correction editor; it does not expose a correction form or add offline correction storage.

Both NestJS and PostgreSQL require current `farmer.read` and `farmer.correct` coverage on the source farmer. Only active configured destinations with both permissions are returned. Creation or verification authority alone grants no correction choices. The database function locks the source row while obtaining its version and geography, uses signed transaction actor context, and does not grant runtime access to the geography table. No business roles, assignments or organization values are seeded by this change.

The response contains authenticated account ID, farmer ID, current farmer version, source geography ID, configured choices and a nullable cursor. There are no hidden totals. Pagination uses increasing geography UUIDs, a default limit of 50 and maximum of 100. A non-null cursor identifies the last returned choice. Clients must bind results to the current account and farmer and restart pagination if the version or source geography changes. Pages are fresh authorization snapshots, not a frozen catalog: permissions and configured locations may change between requests. A cached choice never authorizes a later write; submission repeats source/destination permission and version checks.

Apply native migration 17 through the documented manifest runner before deploying the API. It adds the restricted function without changing existing connection roles or environment requirements. There is no direct production database adoption or manual reference SQL step. See [database operations](../../database/README.md).

## Verification and limits

Synthetic live PostgreSQL tests cover eligible/ineligible/inactive destinations, cursor pages, source and destination permission revocation, source version refresh, unknown records, invalid limits and missing actor context. They also prove the restricted runtime still cannot select the geography table directly. Transport tests cover strict queries, sanitized no-store replies, requested page limits, mismatched farmer IDs, malformed cursors/duplicate choices and cancellation.

The existing farmer-detail capability response includes an optional `correct` hint, retaining compatibility with older replies. It is presentation information only. The editor still needs safe unsaved-change handling, version-conflict review, submission/retry/receipt recovery, bilingual presentation and query isolation tests. No additional farmer fields, device data, project enrollment or lifecycle transitions are implemented here. Registration and verification criteria remain provisional.
