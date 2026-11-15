"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PilotClient, PilotRequestError } from "@agri/sync-client";
const words = {
  en: {
    title: "Your latest visible correction",
    check: "Check my latest correction receipt",
    busy: "Checking correction receipt…",
    empty:
      "No correction receipt is available for this account within current permissions.",
    notice:
      "This receipt belongs to your account. Later changes may exist; refresh the record to see its current state. A missing receipt does not prove that an uncertain request failed.",
    version: "Resulting record version",
    time: "Recorded",
    failure:
      "The correction receipt could not be checked. Refresh the record and check your current permissions.",
  },
  si: {
    title: "ඔබගේ නවතම අවසර ලත් නිවැරදි කිරීම",
    check: "මගේ නවතම නිවැරදි කිරීමේ සටහන පරීක්ෂා කරන්න",
    busy: "නිවැරදි කිරීමේ සටහන පරීක්ෂා කරමින්…",
    empty: "වත්මන් අවසර යටතේ මෙම ගිණුම සඳහා නිවැරදි කිරීමේ සටහනක් ලබාගත නොහැක.",
    notice:
      "මෙය ඔබගේ ගිණුමේ ක්‍රියාවකි. පසුව වෙනස්කම් තිබිය හැක; වත්මන් තත්ත්වය බැලීමට වාර්තාව නැවුම් කරන්න. සටහනක් නොමැති වීම අවිනිශ්චිත ඉල්ලීමක් අසාර්ථක වූ බව සනාථ නොකරයි.",
    version: "ප්‍රතිඵල වාර්තා අනුවාදය",
    time: "සටහන් කළ වේලාව",
    failure:
      "නිවැරදි කිරීමේ සටහන පරීක්ෂා කළ නොහැකි විය. වාර්තාව නැවුම් කර වත්මන් අවසර පරීක්ෂා කරන්න.",
  },
} as const;
type Props = {
  client: PilotClient;
  accountId: string;
  farmerId: string;
  authorizationEpoch: number;
  language: "en" | "si";
  onFailure: (error: unknown) => void;
};
let nextView = 0;
export function FarmerCorrectionReceipt(props: Props) {
  const { client, accountId, farmerId, authorizationEpoch } = props;
  const identity = useMemo(
    () => ++nextView,
    [client, accountId, farmerId, authorizationEpoch],
  );
  return <ReceiptView key={identity} {...props} />;
}
function ReceiptView({
  client,
  accountId,
  farmerId,
  authorizationEpoch,
  language,
  onFailure,
}: Props) {
  const [read, setRead] = useState(0),
    copy = words[language];
  const receipt = useQuery({
    queryKey: [
      "protected",
      { accountId, authorizationEpoch },
      "farmer-correction-receipt",
      farmerId,
      read,
    ],
    enabled: read > 0,
    queryFn: async ({ signal }) => {
      const value = await client.farmerCorrectionReceipt(farmerId, signal);
      signal.throwIfAborted();
      if (value.accountId !== accountId || value.farmerId !== farmerId)
        throw new PilotRequestError(401);
      return value;
    },
  });
  useEffect(() => {
    if (
      receipt.isError &&
      receipt.error instanceof PilotRequestError &&
      [401, 403, 404].includes(receipt.error.status)
    )
      onFailure(receipt.error);
  }, [receipt.isError, receipt.error, onFailure]);
  return (
    <section aria-label={copy.title}>
      <h3>{copy.title}</h3>
      <p>{copy.notice}</p>
      <button
        disabled={receipt.isFetching}
        onClick={() => setRead((value) => value + 1)}
      >
        {copy.check}
      </button>
      {receipt.isFetching && <p role="status">{copy.busy}</p>}
      {receipt.isError && <p role="alert">{copy.failure}</p>}
      {read > 0 &&
        !receipt.isFetching &&
        !receipt.isError &&
        receipt.data &&
        (receipt.data.receipt ? (
          <dl>
            <dt>{copy.version}</dt>
            <dd>{receipt.data.receipt.version}</dd>
            <dt>{copy.time}</dt>
            <dd>
              <time dateTime={receipt.data.receipt.occurredAt}>
                {new Date(receipt.data.receipt.occurredAt).toLocaleString(
                  language === "si" ? "si-LK" : "en-GB",
                )}
              </time>
            </dd>
          </dl>
        ) : (
          <p role="status">{copy.empty}</p>
        ))}
    </section>
  );
}
