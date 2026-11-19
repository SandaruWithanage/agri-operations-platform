"use client";
import { PermissionAction } from "@agri/ui/permission-action";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PilotClient, PilotRequestError } from "@agri/sync-client";
import type { FarmerChange } from "@agri/validation";
export const verificationReviewReason =
  "Staff reviewed the displayed farmer name and configured geography.";
const words = {
  en: {
    title: "Staff record review",
    notice:
      "This reviews the minimal registration record. It does not establish government identity, land ownership or project eligibility.",
    confirm:
      "I reviewed the displayed name and location, including any possible duplicate warning.",
    verify: "Confirm record review",
    retry: "Retry the same verification",
    busy: "Saving review…",
    conflict:
      "The record changed or is no longer pending review. Refresh and review it again; nothing will be overwritten.",
    uncertain:
      "The outcome is uncertain. Retry the same verification while this view is open. After reopening, check your latest receipt and refresh the record before taking another action.",
    failure:
      "The review could not be completed. Refresh the record and check your current permissions.",
    receipt: "Check my latest verification receipt",
    receiptBusy: "Checking receipt…",
    noReceipt:
      "No verification receipt is available for this account within current permissions.",
    receiptTitle: "Your latest visible verification",
    version: "Resulting record version",
    time: "Recorded",
    receiptNotice:
      "This receipt belongs to your account. Later changes may exist; refresh the record to see its current state.",
    receiptFailure:
      "The receipt could not be checked. Refresh the record and check your current permissions.",
    refresh: "Refresh record",
    frozen:
      "The submitted action is fixed for a safe retry. Keep this view open until the result is known, or use the server receipt after reopening.",
  },
  si: {
    title: "කාර්ය මණ්ඩල වාර්තා සමාලෝචනය",
    notice:
      "මෙය අවම ලියාපදිංචි වාර්තාව සමාලෝචනය කිරීමකි. රජයේ අනන්‍යතාව, ඉඩම් අයිතිය හෝ ව්‍යාපෘති සුදුසුකම සනාථ නොකරයි.",
    confirm:
      "සමාන වාර්තා පිළිබඳ අනතුරු ඇඟවීම් ඇතුළුව පෙන්වන නම සහ ස්ථානය මම සමාලෝචනය කළෙමි.",
    verify: "වාර්තා සමාලෝචනය තහවුරු කරන්න",
    retry: "එම තහවුරු කිරීම නැවත උත්සාහ කරන්න",
    busy: "සමාලෝචනය සුරකිමින්…",
    conflict:
      "වාර්තාව වෙනස් වී ඇත හෝ තවදුරටත් සමාලෝචනයට නියමිත නැත. නැවුම් කර නැවත සමාලෝචනය කරන්න; දත්ත උඩින් ලියන්නේ නැත.",
    uncertain:
      "ප්‍රතිඵලය අවිනිශ්චිතයි. මෙම දසුන විවෘතව තිබියදී එම තහවුරු කිරීම නැවත උත්සාහ කරන්න. නැවත විවෘත කළ පසු තවත් ක්‍රියාවකට පෙර ඔබගේ නවතම තහවුරු කිරීම සහ වත්මන් වාර්තාව පරීක්ෂා කරන්න.",
    failure: "සමාලෝචනය සම්පූර්ණ කළ නොහැකි විය. වාර්තාව නැවුම් කර වත්මන් අවසර පරීක්ෂා කරන්න.",
    receipt: "මගේ නවතම තහවුරු කිරීම පරීක්ෂා කරන්න",
    receiptBusy: "තහවුරු කිරීම පරීක්ෂා කරමින්…",
    noReceipt: "වත්මන් අවසර යටතේ මෙම ගිණුම සඳහා තහවුරු කිරීමක් ලබාගත නොහැක.",
    receiptTitle: "ඔබගේ නවතම අවසර ලත් තහවුරු කිරීම",
    version: "ප්‍රතිඵල වාර්තා අනුවාදය",
    time: "සටහන් කළ වේලාව",
    receiptNotice:
      "මෙය ඔබගේ ගිණුමේ ක්‍රියාවකි. පසුව වෙනස්කම් තිබිය හැක; වත්මන් තත්ත්වය බැලීමට වාර්තාව නැවුම් කරන්න.",
    receiptFailure:
      "තහවුරු කිරීම පරීක්ෂා කළ නොහැකි විය. වාර්තාව නැවුම් කර වත්මන් අවසර පරීක්ෂා කරන්න.",
    refresh: "වාර්තාව නැවුම් කරන්න",
    frozen:
      "ආරක්ෂිත නැවත උත්සාහයක් සඳහා යැවූ ක්‍රියාව නොවෙනස්ව රඳවා ඇත. ප්‍රතිඵලය දැනගන්නා තෙක් මෙම දසුන විවෘතව තබන්න, නැතහොත් නැවත විවෘත කළ පසු සේවාදායකයේ සටහන පරීක්ෂා කරන්න.",
  },
} as const;
type Props = {
  client: PilotClient;
  accountId: string;
  farmerId: string;
  version: number;
  status: string;
  authorizationEpoch: number;
  language: "en" | "si";
  onRefresh: () => void;
  onFailure: (error: unknown) => void;
};
let nextIntent = 0;
export function FarmerVerification(props: Props) {
  const { client, accountId, farmerId, version, authorizationEpoch } = props;
  const identity = useMemo(
    () => ++nextIntent,
    [client, accountId, farmerId, version, authorizationEpoch],
  );
  return <VerificationIntent key={identity} {...props} />;
}
function VerificationIntent({
  client,
  accountId,
  farmerId,
  version,
  status,
  authorizationEpoch,
  language,
  onRefresh,
  onFailure,
}: Props) {
  const copy = words[language];
  const active = useRef(true);
  const intentId = useRef<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [receiptRead, setReceiptRead] = useState(0);
  const forbidden = (error: unknown) =>
    error instanceof PilotRequestError &&
    [401, 403, 404].includes(error.status);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const mutation = useMutation({
    mutationKey: [
      "protected",
      { accountId, authorizationEpoch },
      "farmer-verification",
      farmerId,
      version,
    ],
    mutationFn: (input: FarmerChange) => client.changeFarmer(accountId, input),
    onSuccess: () => {
      if (active.current) onRefresh();
    },
    onError: (error) => {
      if (active.current && forbidden(error)) onFailure(error);
    },
  });
  const uncertain =
    mutation.isError &&
    (!(mutation.error instanceof PilotRequestError) ||
      mutation.error.status >= 500);
  useEffect(() => {
    if (!mutation.isPending && !uncertain) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [mutation.isPending, uncertain]);
  const receipt = useQuery({
    queryKey: [
      "protected",
      { accountId, authorizationEpoch },
      "farmer-verification-receipt",
      farmerId,
      receiptRead,
    ],
    enabled: receiptRead > 0,
    queryFn: async ({ signal }) => {
      const value = await client.farmerVerificationReceipt(farmerId, signal);
      signal.throwIfAborted();
      if (value.accountId !== accountId) throw new PilotRequestError(401);
      return value;
    },
  });
  useEffect(() => {
    if (receipt.isError && forbidden(receipt.error)) onFailure(receipt.error);
  }, [receipt.isError, receipt.error]);
  const canVerify = status === "pending-review" && version < 2147483647;
  return (
    <section aria-label={copy.title}>
      <h3>{copy.title}</h3>
      <p>{copy.notice}</p>
      {canVerify && (
        <>
          <label className="review-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={mutation.variables !== undefined}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            {copy.confirm}
          </label>
          {!mutation.variables && (
            <PermissionAction
              code="farmer.verify"
              disabled={!confirmed}
              onClick={() =>
                mutation.mutate({
                  mutationId: (intentId.current ??= crypto.randomUUID()),
                  farmerId,
                  expectedVersion: version,
                  action: "verification",
                  reason: verificationReviewReason,
                })
              }
            >
              {copy.verify}
            </PermissionAction>
          )}
        </>
      )}
      {mutation.isPending && <p role="status">{copy.busy}</p>}
      {mutation.variables && <p>{copy.frozen}</p>}
      {mutation.isError && (
        <p role="alert">
          {uncertain
            ? copy.uncertain
            : mutation.error instanceof PilotRequestError &&
                mutation.error.status === 409
              ? copy.conflict
              : copy.failure}
        </p>
      )}
      {uncertain && mutation.variables && (
        <button onClick={() => mutation.mutate(mutation.variables!)}>
          {copy.retry}
        </button>
      )}
      <div className="actions">
        <button
          disabled={mutation.isPending || receipt.isFetching}
          onClick={() => setReceiptRead((value) => value + 1)}
        >
          {copy.receipt}
        </button>
        <button disabled={mutation.isPending} onClick={onRefresh}>
          {copy.refresh}
        </button>
      </div>
      {receipt.isFetching && <p role="status">{copy.receiptBusy}</p>}
      {receipt.isError && <p role="alert">{copy.receiptFailure}</p>}
      {receiptRead > 0 &&
        !receipt.isFetching &&
        !receipt.isError &&
        receipt.data &&
        (receipt.data.receipt ? (
          <>
            <h4>{copy.receiptTitle}</h4>
            <p>{copy.receiptNotice}</p>
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
          </>
        ) : (
          <p role="status">{copy.noReceipt}</p>
        ))}
    </section>
  );
}
