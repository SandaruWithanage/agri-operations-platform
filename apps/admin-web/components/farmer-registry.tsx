"use client";
import { LocaleProvider, useLocale } from "@agri/i18n/react";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createProtectedQueryClient } from "../lib/protected-query";
import { LandDirectory, landWords } from "./land-directory";
import { FarmerCorrection, type CorrectionDraft } from "./farmer-correction";
import {
  FarmerRegistrationEditor,
  type RegistrationDraft,
} from "./farmer-registration";
import { registrationWords } from "./registration-words";
import { correctionWords } from "./correction-words";
import { FarmerCorrectionReceipt } from "./farmer-correction-receipt";
import { FarmerVerification } from "./farmer-verification";
import { FarmerHistory } from "./farmer-history";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { PilotClient, PilotRequestError } from "@agri/sync-client";
import { sameFarmerFilters, type FarmerListFilters } from "@agri/validation";
import { readReviewFilters, reviewFilterUrl } from "../lib/review-filters";
import type { FarmerSummary } from "@agri/validation";
const words = {
  en: {
    language: "Language",
    title: "Farmer registry",
    login: "Account name",
    password: "Password",
    otp: "Authenticator code",
    device: "Approved device ID",
    signIn: "Sign in",
    logout: "Sign out",
    refresh: "Check session and refresh",
    next: "Next page",
    back: "Previous page",
    prepare: "Download device enrollment request",
    prepared:
      "Send the public enrollment request to your administrator through the approved channel. Verify its code independently before sign-in.",
    fingerprint: "Device verification code",
    name: "Full name",
    location: "GN division or village",
    status: "Status",
    created: "Registered",
    detail: "View record",
    empty:
      "No farmer records are available within your current read permissions.",
    busy: "Please wait…",
    filterTitle: "Review filters",
    filterStatus: "Registration status",
    allStatuses: "All statuses",
    reviewable: "Only pending records I may verify",
    filteredEmpty:
      "No records match these filters within your current permissions.",
    invalidFilters:
      "The shared review filters are invalid. Reset them before loading records.",
    resetFilters: "Reset filters",
    auth: "Sign in with your organization account, authenticator and approved device.",
    failure:
      "The request could not be completed. Check your connection, account and permissions, or contact your administrator.",
    missing:
      "This farmer is not available within your current read permissions.",
    scope:
      "Only records allowed by your current permissions and assignments are shown. Registration permission alone does not grant access to existing records.",
    close: "Close record",
    pending: "Pending review",
    draft: "Draft",
    verified: "Verified",
    inactive: "Inactive",
    review: "Core registration record.",
    history: "Show record history",
    duplicate:
      "Possible duplicate: another visible record has the same name and location. Review the records separately; do not merge them automatically.",
  },
  si: {
    language: "භාෂාව",
    title: "ගොවි ලේඛනය",
    login: "ගිණුම් නාමය",
    password: "මුරපදය",
    otp: "සත්‍යාපක කේතය",
    device: "අනුමත උපාංග හැඳුනුම් අංකය",
    signIn: "පුරන්න",
    logout: "වරන්න",
    refresh: "සැසිය පරීක්ෂා කර නැවුම් කරන්න",
    next: "ඊළඟ පිටුව",
    back: "පෙර පිටුව",
    prepare: "උපාංග ලියාපදිංචි ඉල්ලීම බාගන්න",
    prepared:
      "පොදු ලියාපදිංචි ඉල්ලීම අනුමත මාර්ගයෙන් පරිපාලක වෙත යවන්න. පුරනයට පෙර කේතය ස්වාධීනව තහවුරු කරන්න.",
    fingerprint: "උපාංග තහවුරු කිරීමේ කේතය",
    name: "සම්පූර්ණ නම",
    location: "ග්‍රාම නිලධාරී වසම හෝ ගම",
    status: "තත්ත්වය",
    created: "ලියාපදිංචි දිනය",
    detail: "වාර්තාව බලන්න",
    empty: "ඔබගේ වත්මන් කියවීමේ අවසර යටතේ ගොවි වාර්තා නොමැත.",
    busy: "රැඳී සිටින්න…",
    filterTitle: "සමාලෝචන පෙරහන්",
    filterStatus: "ලියාපදිංචි තත්ත්වය",
    allStatuses: "සියලු තත්ත්ව",
    reviewable: "මට තහවුරු කළ හැකි සමාලෝචනයට නියමිත වාර්තා පමණි",
    filteredEmpty: "වත්මන් අවසර සහ තෝරාගත් පෙරහන් යටතේ වාර්තා නොමැත.",
    invalidFilters:
      "බෙදාගත් සමාලෝචන පෙරහන් වලංගු නැත. වාර්තා පූරණයට පෙර ඒවා යළි සකසන්න.",
    resetFilters: "පෙරහන් යළි සකසන්න",
    auth: "ආයතනික ගිණුම, සත්‍යාපකය සහ අනුමත උපාංගයෙන් පුරන්න.",
    failure:
      "ඉල්ලීම සම්පූර්ණ කළ නොහැකි විය. සම්බන්ධතාව, ගිණුම හා අවසර පරීක්ෂා කරන්න හෝ පරිපාලක අමතන්න.",
    missing: "වත්මන් කියවීමේ අවසර යටතේ මෙම ගොවියාගේ වාර්තාව ලබාගත නොහැක.",
    scope:
      "වත්මන් අවසර සහ පැවරුම් යටතේ ඇති වාර්තා පමණක් පෙන්වයි. ලියාපදිංචි අවසරය පමණක් පවතින වාර්තා කියවීමට අවසර නොදේ.",
    close: "වාර්තාව වසන්න",
    pending: "සමාලෝචනයට නියමිතයි",
    draft: "කෙටුම්පත",
    verified: "තහවුරු කළ",
    inactive: "අක්‍රීය",
    review: "මූලික ලියාපදිංචි වාර්තාව.",
    history: "වාර්තා ඉතිහාසය පෙන්වන්න",
    duplicate:
      "සමාන වාර්තාවක් තිබිය හැක: එකම නම සහ ස්ථානය සහිත තවත් අවසර ලත් වාර්තාවක් ඇත. වාර්තා වෙන වෙනම සමාලෝචනය කරන්න; ස්වයංක්‍රීයව ඒකාබද්ධ නොකරන්න.",
  },
} as const;
type Context = Pick<
  Awaited<ReturnType<PilotClient["context"]>>,
  "accountId" | "deviceId"
>;
type Domain = "farmers" | "land";
type ReadRequest = {
  epoch: number;
  domain: Domain;
  filters?: FarmerListFilters;
} & ({ kind: "list"; cursor?: string } | { kind: "detail"; id: string });
let nextRegistryBoundary = 0;
let nextOnlineDraft = 0;
type RegistryControl = {
  id: number;
  action: "refresh" | "clear" | "failure";
  error?: unknown;
  recordId?: string;
};
export function FarmerRegistry(props: { client?: PilotClient }) {
  return (
    <LocaleProvider initial="en">
      <AdminWorkspace {...props} />
    </LocaleProvider>
  );
}
function AdminWorkspace({ client: supplied }: { client?: PilotClient }) {
  const [fallback] = useState(() => new PilotClient());
  const client = supplied ?? fallback;
  const boundary = useMemo(
    () => ({
      id: ++nextRegistryBoundary,
      queries: createProtectedQueryClient(),
    }),
    [client],
  );
  const [language] = useLocale();
  const [draft, setDraft] = useState<CorrectionDraft | null>(null);
  const [lockEpoch, setLockEpoch] = useState(0);
  const [registration, setRegistration] = useState<RegistrationDraft | null>(
    null,
  );
  const [saved, setSaved] = useState<"correction" | "registration" | null>(
    null,
  );
  const [control, setControl] = useState<RegistryControl>({
    id: 0,
    action: "clear",
  });
  const draftLock = useRef<(() => void) | null>(null);
  const lockDraft = useCallback(() => {
    draftLock.current?.();
    setLockEpoch((value) => value + 1);
  }, []);
  const registerLock = useCallback((lock: () => void) => {
    draftLock.current = lock;
    return () => {
      if (draftLock.current === lock) draftLock.current = null;
    };
  }, []);
  const failure = useCallback(
    (error: unknown) =>
      setControl((value) => ({ id: value.id + 1, action: "failure", error })),
    [],
  );
  return (
    <>
      {saved && (
        <p className="correction-saved" role="status">
          {saved === "correction"
            ? correctionWords[language].saved
            : registrationWords[language].saved}
        </p>
      )}
      <QueryClientProvider
        key={`registry:${boundary.id}`}
        client={boundary.queries}
      >
        <RegistryView
          client={client}
          correctionOpen={draft !== null || registration !== null}
          onRegister={(owner) => {
            if (draft || registration) return;
            setSaved(null);
            setRegistration({
              ...owner,
              id: ++nextOnlineDraft,
              client,
              boundaryEpoch: lockEpoch,
            });
          }}
          onProtectedClear={lockDraft}
          control={control}
          onCorrect={(source, owner) => {
            if (draft || registration) return;
            setSaved(null);
            setDraft({
              ...owner,
              id: ++nextOnlineDraft,
              client,
              boundaryEpoch: lockEpoch,
              source: {
                id: source.id,
                fullName: source.fullName,
                geographyId: source.geographyId,
                version: source.version,
              },
            });
          }}
        />
      </QueryClientProvider>
      {registration && (
        <FarmerRegistrationEditor
          key={`registration:${registration.id}`}
          draft={registration}
          activeClient={client}
          boundaryEpoch={lockEpoch}
          language={language}
          registerLock={registerLock}
          onFailure={failure}
          onIdle={() =>
            setControl((value) => ({ id: value.id + 1, action: "clear" }))
          }
          onDiscard={() => setRegistration(null)}
          onSaved={() => {
            setRegistration(null);
            setSaved("registration");
            setControl((value) => ({ id: value.id + 1, action: "refresh" }));
          }}
        />
      )}
      {draft && (
        <FarmerCorrection
          key={`correction:${draft.id}`}
          draft={draft}
          activeClient={client}
          boundaryEpoch={lockEpoch}
          language={language}
          registerLock={registerLock}
          onFailure={failure}
          onIdle={() =>
            setControl((value) => ({ id: value.id + 1, action: "clear" }))
          }
          onDiscard={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            setSaved("correction");
            setControl((value) => ({
              id: value.id + 1,
              action: "refresh",
              recordId: draft.source.id,
            }));
          }}
        />
      )}
    </>
  );
}
function RegistryView({
  client,
  correctionOpen,
  onCorrect,
  onRegister,
  onProtectedClear,
  control,
}: {
  client: PilotClient;
  correctionOpen: boolean;
  onCorrect: (source: FarmerSummary, owner: Context) => void;
  onRegister: (owner: Context) => void;
  onProtectedClear: () => void;
  control: RegistryControl;
}) {
  const [language, setLanguage] = useLocale();
  const copy = words[language];
  const landCopy = landWords[language];
  const [domain, setDomain] = useState<Domain>("farmers");
  const [filters, setFilters] = useState<FarmerListFilters>({});
  const [invalidFilters, setInvalidFilters] = useState(false);
  const [context, setContext] = useState<Context | null>(null);
  const [request, setRequest] = useState<ReadRequest | null>(null);
  const queries = useQueryClient();
  const authRequest = useRef<AbortController | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [authBusy, setBusy] = useState(false);
  const [message, setMessage] = useState<
    "auth" | "failure" | "missing" | "prepared" | null
  >(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const sequence = useRef(0),
    active = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  const query = useQuery({
    queryKey: [
      "protected",
      {
        accountId: context?.accountId,
        deviceId: context?.deviceId,
        authorizationEpoch: request?.epoch,
      },
      request?.domain,
      request?.kind,
      request?.kind === "list"
        ? {
            limit: 25,
            after: request.cursor ?? null,
            ...(request.domain === "farmers" ? request.filters : {}),
          }
        : request?.kind === "detail"
          ? { id: request.id }
          : null,
    ],
    enabled: context !== null && request !== null,
    queryFn: async ({ signal }) => {
      if (!context || !request) throw new Error("No active read context");
      const result =
        request.domain === "farmers"
          ? request.kind === "list"
            ? {
                kind: "farmer-list" as const,
                value: await client.farmers(
                  request.cursor,
                  signal,
                  request.filters,
                ),
              }
            : {
                kind: "farmer-detail" as const,
                value: await client.farmer(request.id, signal),
              }
          : request.kind === "list"
            ? {
                kind: "land-list" as const,
                value: await client.land(request.cursor, signal),
              }
            : {
                kind: "land-detail" as const,
                value: await client.landIdentification(request.id, signal),
              };
      signal.throwIfAborted();
      if (
        result.kind === "farmer-list" &&
        !sameFarmerFilters(request.filters ?? {}, result.value.filters)
      )
        throw new PilotRequestError(503);
      if (result.value.accountId !== context.accountId)
        throw new PilotRequestError(401);
      return result;
    },
  });
  const busy = authBusy || (request !== null && query.isFetching);
  const data =
    request !== null && !busy && !query.isError ? query.data : undefined;
  const rows = data?.kind === "farmer-list" ? data.value.items : [];
  const next =
    data?.kind === "farmer-list" || data?.kind === "land-list"
      ? data.value.nextCursor
      : null;
  const selected = data?.kind === "farmer-detail" ? data.value.farmer : null;
  const canViewAudit =
    data?.kind === "farmer-detail" && data.value.access?.viewAudit === true;
  function clear() {
    onProtectedClear();
    sequence.current++;
    authRequest.current?.abort();
    authRequest.current = null;
    void queries.cancelQueries();
    queries.clear();
    setRequest(null);
    setShowHistory(false);
  }
  function report(error: unknown) {
    clear();
    setBusy(false);
    if (error instanceof PilotRequestError && error.status === 401) {
      setContext(null);
      setMessage("auth");
    } else
      setMessage(
        error instanceof PilotRequestError && error.status === 404
          ? "missing"
          : "failure",
      );
  }
  async function load(
    cursor?: string,
    history: Array<string | undefined> = [undefined],
    nextDomain: Domain = domain,
    nextFilters: FarmerListFilters = filters,
    recordId?: string,
  ) {
    setDomain(nextDomain);
    setInvalidFilters(false);
    if (nextDomain === "farmers") {
      setFilters(nextFilters);
      try {
        const target = reviewFilterUrl(
          new URL(window.location.href),
          nextFilters,
        );
        window.history.replaceState(window.history.state, "", target);
      } catch {
        /* Optional shareable view selection; no protected data is persisted. */
      }
    }
    clear();
    const generation = sequence.current;
    setBusy(true);
    setMessage(null);
    try {
      const controller = new AbortController();
      authRequest.current = controller;
      const current = await client.context(controller.signal);
      if (!active.current || generation !== sequence.current) return;
      setContext({ accountId: current.accountId, deviceId: current.deviceId });
      setCursors(history);
      setRequest(
        recordId
          ? {
              kind: "detail",
              id: recordId,
              epoch: generation,
              domain: "farmers",
            }
          : {
              kind: "list",
              cursor,
              epoch: generation,
              domain: nextDomain,
              ...(nextDomain === "farmers" ? { filters: nextFilters } : {}),
            },
      );
    } catch (error) {
      if (active.current && generation === sequence.current) report(error);
    } finally {
      if (active.current && generation === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    const restoreFilters = () => {
      const restored = readReviewFilters(new URL(window.location.href));
      if (restored === null) {
        clear();
        setInvalidFilters(true);
        setBusy(false);
        return;
      }
      void load(undefined, [undefined], "farmers", restored);
    };
    restoreFilters();
    window.addEventListener("popstate", restoreFilters);
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        clear();
        setBusy(false);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active.current = false;
      sequence.current++;
      authRequest.current?.abort();
      void queries.cancelQueries();
      queries.clear();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("popstate", restoreFilters);
    };
  }, [client]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const element = event.currentTarget,
      data = new FormData(element);
    setBusy(true);
    clear();
    const generation = sequence.current;
    try {
      await client.login({
        loginName: String(data.get("loginName") ?? ""),
        password: String(data.get("password") ?? ""),
        otp: String(data.get("otp") ?? ""),
        deviceId: String(data.get("deviceId") ?? ""),
      });
      if (active.current && generation === sequence.current) await load();
    } catch (error) {
      if (active.current && generation === sequence.current) report(error);
    } finally {
      (element.elements.namedItem("password") as HTMLInputElement).value = "";
      (element.elements.namedItem("otp") as HTMLInputElement).value = "";
      setBusy(false);
    }
  }
  function detail(id: string) {
    clear();
    setMessage(null);
    if (context)
      setRequest({ kind: "detail", id, epoch: sequence.current, domain });
  }
  useEffect(() => {
    if (request && query.isError) report(query.error);
  }, [query.isError, query.error, request]);
  useEffect(() => {
    if (!control.id) return;
    if (control.action === "refresh")
      void load(undefined, [undefined], "farmers", filters, control.recordId);
    else if (control.action === "failure") report(control.error);
    else {
      clear();
      setBusy(false);
    }
  }, [control.id]);
  const status = (value: FarmerSummary["status"]) =>
    value === "pending-review"
      ? copy.pending
      : value === "draft"
        ? copy.draft
        : value === "verified"
          ? copy.verified
          : copy.inactive;
  return (
    <main>
      <nav className="actions" aria-label={copy.language}>
        {(["en", "si"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={language === value}
            onClick={() => setLanguage(value)}
          >
            {value === "en" ? "English" : "සිංහල"}
          </button>
        ))}
      </nav>
      <nav
        className="actions"
        aria-label={language === "en" ? "Records" : "වාර්තා"}
      >
        <button
          disabled={authBusy}
          aria-pressed={domain === "farmers"}
          onClick={() => void load(undefined, [undefined], "farmers")}
        >
          {language === "en" ? "Farmers" : "ගොවීන්"}
        </button>
        <button
          disabled={authBusy}
          aria-pressed={domain === "land"}
          onClick={() => void load(undefined, [undefined], "land")}
        >
          {landCopy.tab}
        </button>
      </nav>
      <h1>{domain === "farmers" ? copy.title : landCopy.title}</h1>
      {invalidFilters && (
        <div role="alert">
          <p>{copy.invalidFilters}</p>
          <button
            onClick={() => void load(undefined, [undefined], "farmers", {})}
          >
            {copy.resetFilters}
          </button>
        </div>
      )}
      <p>{domain === "farmers" ? copy.scope : landCopy.scope}</p>
      {message && (
        <p role={message === "prepared" ? "status" : "alert"}>
          {message === "missing" && domain === "land"
            ? landCopy.missing
            : copy[message]}
        </p>
      )}
      {busy && <p role="status">{copy.busy}</p>}
      <div className="actions">
        <button disabled={busy} onClick={() => void load()}>
          {copy.refresh}
        </button>
        {context && (
          <button
            disabled={busy || correctionOpen}
            onClick={() => onRegister(context)}
          >
            {registrationWords[language].start}
          </button>
        )}
        {context && (
          <button
            disabled={busy}
            onClick={async () => {
              const previous = context;
              clear();
              setContext(null);
              setBusy(true);
              try {
                await client.logout(previous);
              } catch {
                setMessage("failure");
              } finally {
                setBusy(false);
              }
            }}
          >
            {copy.logout}
          </button>
        )}
      </div>
      {!context && (
        <form ref={form} className="sign-in" onSubmit={login}>
          <p>{copy.auth}</p>
          <label htmlFor="admin-login">{copy.login}</label>
          <input
            id="admin-login"
            name="loginName"
            autoComplete="username"
            required
            maxLength={200}
            disabled={busy}
          />
          <label htmlFor="admin-password">{copy.password}</label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            disabled={busy}
          />
          <label htmlFor="admin-otp">{copy.otp}</label>
          <input
            id="admin-otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
            maxLength={6}
            disabled={busy}
          />
          <label htmlFor="admin-device">{copy.device}</label>
          <input
            id="admin-device"
            name="deviceId"
            autoComplete="off"
            required
            maxLength={36}
            disabled={busy}
          />
          <div className="actions">
            <button type="submit" disabled={busy}>
              {copy.signIn}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const deviceId = (
                  form.current?.elements.namedItem(
                    "deviceId",
                  ) as HTMLInputElement
                )?.value;
                setBusy(true);
                setMessage(null);
                try {
                  const request = await client.prepareDevice(deviceId);
                  setFingerprint(request.fingerprint);
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(request, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "agri-device-enrollment.json";
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  setMessage("prepared");
                } catch {
                  setMessage("failure");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {copy.prepare}
            </button>
          </div>
          {fingerprint && (
            <p>
              {copy.fingerprint}: <output>{fingerprint}</output>
            </p>
          )}
        </form>
      )}
      {domain === "farmers" &&
        context &&
        !selected &&
        request?.kind !== "detail" &&
        !invalidFilters && (
          <div
            role="group"
            className="review-filters"
            aria-label={copy.filterTitle}
          >
            <label htmlFor="registry-status-filter">{copy.filterStatus}</label>
            <select
              id="registry-status-filter"
              value={filters.status ?? "all"}
              disabled={authBusy}
              onChange={(event) => {
                const chosen = event.target.value as
                  "all" | FarmerSummary["status"];
                void load(undefined, [undefined], "farmers", {
                  ...(chosen !== "all" ? { status: chosen } : {}),
                  ...(chosen === "pending-review" && filters.reviewable
                    ? { reviewable: "true" }
                    : {}),
                });
              }}
            >
              <option value="all">{copy.allStatuses}</option>
              <option value="draft">{copy.draft}</option>
              <option value="pending-review">{copy.pending}</option>
              <option value="verified">{copy.verified}</option>
              <option value="inactive">{copy.inactive}</option>
            </select>
            <label className="review-confirmation">
              <input
                type="checkbox"
                checked={filters.reviewable === "true"}
                disabled={authBusy}
                onChange={(event) =>
                  void load(
                    undefined,
                    [undefined],
                    "farmers",
                    event.target.checked
                      ? { status: "pending-review", reviewable: "true" }
                      : {
                          ...(filters.status ? { status: filters.status } : {}),
                        },
                  )
                }
              />
              {copy.reviewable}
            </label>
          </div>
        )}
      {domain === "farmers" &&
        context &&
        !busy &&
        !selected &&
        !invalidFilters && (
          <>
            {rows.length === 0 ? (
              <p role="status">
                {filters.status || filters.reviewable
                  ? copy.filteredEmpty
                  : copy.empty}
              </p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{copy.name}</th>
                      <th scope="col">{copy.location}</th>
                      <th scope="col">{copy.status}</th>
                      <th scope="col">{copy.created}</th>
                      <th scope="col">{copy.detail}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.fullName}</td>
                        <td>{row.geographyName}</td>
                        <td>{status(row.status)}</td>
                        <td>
                          {new Date(row.createdAt).toLocaleDateString(
                            language === "si" ? "si-LK" : "en-GB",
                          )}
                        </td>
                        <td>
                          <button
                            onClick={() => void detail(row.id)}
                            aria-label={`${copy.detail}: ${row.fullName}`}
                          >
                            {copy.detail}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="actions">
              <button
                disabled={cursors.length < 2}
                onClick={() => {
                  const history = cursors.slice(0, -1);
                  void load(history[history.length - 1], history);
                }}
              >
                {copy.back}
              </button>
              <button
                disabled={!next}
                onClick={() => {
                  if (next) void load(next, [...cursors, next]);
                }}
              >
                {copy.next}
              </button>
            </div>
          </>
        )}
      {domain === "land" && context && !busy && (
        <LandDirectory
          language={language}
          page={data?.kind === "land-list" ? data.value : undefined}
          detail={data?.kind === "land-detail" ? data.value : undefined}
          canBack={cursors.length > 1}
          onOpen={detail}
          onClose={() => void load()}
          onBack={() => {
            const history = cursors.slice(0, -1);
            void load(history[history.length - 1], history);
          }}
          onNext={() => {
            if (next) void load(next, [...cursors, next]);
          }}
        />
      )}
      {domain === "farmers" && selected && (
        <section aria-label={copy.detail}>
          <h2>{selected.fullName}</h2>
          {selected.duplicateRisk && <p role="status">{copy.duplicate}</p>}
          <dl>
            <dt>{copy.location}</dt>
            <dd>{selected.geographyName}</dd>
            <dt>{copy.status}</dt>
            <dd>{status(selected.status)}</dd>
            <dt>{copy.created}</dt>
            <dd>
              {new Date(selected.createdAt).toLocaleString(
                language === "si" ? "si-LK" : "en-GB",
              )}
            </dd>
          </dl>
          <p>{copy.review}</p>
          {data?.kind === "farmer-detail" &&
            data.value.access?.verify === true &&
            context && (
              <FarmerVerification
                client={client}
                accountId={context.accountId}
                farmerId={selected.id}
                version={selected.version}
                status={selected.status}
                authorizationEpoch={sequence.current}
                language={language}
                onRefresh={() => detail(selected.id)}
                onFailure={report}
              />
            )}
          {data?.kind === "farmer-detail" &&
            data.value.access?.correct === true &&
            context && (
              <>
                <button
                  disabled={correctionOpen}
                  onClick={() => onCorrect(selected, context)}
                >
                  {correctionWords[language].start}
                </button>
                {correctionOpen && (
                  <p>{registrationWords[language].occupied}</p>
                )}
              </>
            )}
          {data?.kind === "farmer-detail" &&
            data.value.access?.correct === true &&
            context && (
              <FarmerCorrectionReceipt
                client={client}
                accountId={context.accountId}
                farmerId={selected.id}
                authorizationEpoch={sequence.current}
                language={language}
                onFailure={report}
              />
            )}
          {canViewAudit && !showHistory && (
            <button onClick={() => setShowHistory(true)}>{copy.history}</button>
          )}
          {showHistory && context && (
            <FarmerHistory
              key={`${context.accountId}:${selected.id}`}
              client={client}
              accountId={context.accountId}
              authorizationEpoch={sequence.current}
              farmerId={selected.id}
              language={language}
              onFailure={report}
            />
          )}
          <button onClick={() => void load()}>{copy.close}</button>
        </section>
      )}
    </main>
  );
}
