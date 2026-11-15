"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createProtectedQueryClient,
  farmerHistoryKey,
} from "../lib/protected-query";
import { PilotClient, PilotRequestError } from "@agri/sync-client";
import type { FarmerHistoryCursor } from "@agri/validation";
const words = {
  en: {
    title: "Record history",
    scope: "Only events allowed by your current permissions are shown.",
    latest: "Latest events",
    older: "Older events",
    busy: "Loading history…",
    empty: "No history is available within your current audit permissions.",
    failure:
      "History could not be loaded. Check your current account and audit permissions.",
    registration: "Registration",
    correction: "Correction",
    verification: "Record verification",
    actor: "Account responsible",
    reason: "Reason",
    previous: "Before",
    result: "After",
    revision: "Record revision",
    duplicate: "Possible duplicate flagged for review",
    legacy:
      "This registration event records who and when. Original field values were not captured.",
    draft: "Draft",
    pending: "Pending review",
    verified: "Verified",
    inactive: "Inactive",
  },
  si: {
    title: "වාර්තා ඉතිහාසය",
    scope: "වත්මන් අවසර යටතේ ඇති සිදුවීම් පමණක් පෙන්වයි.",
    latest: "නවතම සිදුවීම්",
    older: "පැරණි සිදුවීම්",
    busy: "ඉතිහාසය පූරණය කරමින්…",
    empty: "වත්මන් විගණන අවසර යටතේ ඉතිහාසයක් ලබාගත නොහැක.",
    failure: "ඉතිහාසය පූරණය කළ නොහැකි විය. වත්මන් ගිණුම සහ විගණන අවසර පරීක්ෂා කරන්න.",
    registration: "ලියාපදිංචිය",
    correction: "නිවැරදි කිරීම",
    verification: "වාර්තාව තහවුරු කිරීම",
    actor: "වගකිව යුතු ගිණුම",
    reason: "හේතුව",
    previous: "පෙර",
    result: "පසු",
    revision: "වාර්තා සංශෝධනය",
    duplicate: "සමාන වාර්තාවක් තිබිය හැකි බැවින් සමාලෝචනයට සලකුණු කර ඇත",
    legacy:
      "මෙම ලියාපදිංචි සිදුවීම සිදු කළ ගිණුම සහ වේලාව දක්වයි. මුල් ක්ෂේත්‍ර අගයන් සුරැකී නොමැත.",
    draft: "කෙටුම්පත",
    pending: "සමාලෝචනයට නියමිතයි",
    verified: "තහවුරු කළ",
    inactive: "අක්‍රීය",
  },
} as const;
type Props = {
  client: PilotClient;
  accountId: string;
  farmerId: string;
  language: "en" | "si";
  authorizationEpoch?: number;
  onFailure?: (error: unknown) => void;
};
let nextBoundary = 0;
/** A new protected view never inherits another account/session/scope's cache. */
export function FarmerHistory(props: Props) {
  const { client, accountId, farmerId, authorizationEpoch = 0 } = props;
  const boundary = useMemo(
    () => ({
      id: ++nextBoundary,
      queries: createProtectedQueryClient(),
    }),
    [client, accountId, farmerId, authorizationEpoch],
  );
  return (
    <QueryClientProvider key={boundary.id} client={boundary.queries}>
      <HistoryView {...props} />
    </QueryClientProvider>
  );
}
function HistoryView({
  client,
  accountId,
  farmerId,
  language,
  authorizationEpoch = 0,
  onFailure,
}: Props) {
  const copy = words[language];
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<{
    cursor?: FarmerHistoryCursor;
    revision: number;
  }>({ revision: 0 });
  const listener = useRef(onFailure);
  listener.current = onFailure;
  const query = useQuery({
    queryKey: farmerHistoryKey(
      accountId,
      authorizationEpoch,
      request.revision,
      farmerId,
      request.cursor,
    ),
    queryFn: async ({ signal }) => {
      const value = await client.farmerHistory(
        farmerId,
        request.cursor,
        signal,
      );
      signal.throwIfAborted();
      if (value.accountId !== accountId || value.farmerId !== farmerId)
        throw new PilotRequestError(401);
      return value;
    },
  });
  useEffect(() => {
    if (query.isError) listener.current?.(query.error);
  }, [query.isError, query.error]);
  useEffect(
    () => () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    },
    [queryClient],
  );
  function load(cursor?: FarmerHistoryCursor) {
    // Each explicit request rechecks authority; no cached snapshot is a grant.
    setRequest((previous) => ({ cursor, revision: previous.revision + 1 }));
  }
  const busy = query.isPending || query.isFetching;
  const failed = query.isError;
  const page = !busy && !failed ? query.data : undefined;
  const status = (value: string) =>
    value === "pending-review"
      ? copy.pending
      : value === "verified"
        ? copy.verified
        : value === "inactive"
          ? copy.inactive
          : copy.draft;
  return (
    <section aria-label={copy.title}>
      <h3>{copy.title}</h3>
      <p>{copy.scope}</p>
      {busy && <p role="status">{copy.busy}</p>}
      {failed && <p role="alert">{copy.failure}</p>}
      {page && (
        <>
          {page.items.length === 0 ? (
            <p role="status">{copy.empty}</p>
          ) : (
            <ol className="audit-events">
              {page.items.map((event) => (
                <li key={event.eventId}>
                  <h4>{copy[event.action]}</h4>
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleString(
                      language === "si" ? "si-LK" : "en-GB",
                    )}
                  </time>
                  <p>
                    {copy.actor}: <code>{event.actorAccountId}</code>
                  </p>
                  {event.change ? (
                    <>
                      <p>
                        {copy.reason}: {event.change.reason}
                      </p>
                      <p>
                        {copy.revision}: {event.change.previousVersion} →{" "}
                        {event.change.resultVersion}
                      </p>
                      <dl>
                        <dt>{copy.previous}</dt>
                        <dd>
                          {event.change.previous.fullName} ·{" "}
                          {event.change.previous.geographyName} ·{" "}
                          {status(event.change.previous.status)}
                        </dd>
                        <dt>{copy.result}</dt>
                        <dd>
                          {event.change.result.fullName} ·{" "}
                          {event.change.result.geographyName} ·{" "}
                          {status(event.change.result.status)}
                        </dd>
                      </dl>
                      {event.change.duplicateRisk && <p>{copy.duplicate}</p>}
                    </>
                  ) : (
                    <p>{copy.legacy}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <div className="actions">
        <button disabled={busy} onClick={() => void load()}>
          {copy.latest}
        </button>
        <button
          disabled={busy || !page?.nextCursor}
          onClick={() => {
            if (page?.nextCursor) void load(page.nextCursor);
          }}
        >
          {copy.older}
        </button>
      </div>
    </section>
  );
}
