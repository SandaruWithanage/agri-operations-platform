"use client";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createProtectedQueryClient } from "../lib/protected-query";
import { FarmerHistory } from "./farmer-history";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PilotClient, PilotRequestError } from "@agri/sync-client";
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
    review: "Read-only record view.",
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
    review: "කියවීමට පමණක් ඇති වාර්තා දසුනකි.",
    history: "වාර්තා ඉතිහාසය පෙන්වන්න",
    duplicate:
      "සමාන වාර්තාවක් තිබිය හැක: එකම නම සහ ස්ථානය සහිත තවත් අවසර ලත් වාර්තාවක් ඇත. වාර්තා වෙන වෙනම සමාලෝචනය කරන්න; ස්වයංක්‍රීයව ඒකාබද්ධ නොකරන්න.",
  },
} as const;
type Context = Pick<
  Awaited<ReturnType<PilotClient["context"]>>,
  "accountId" | "deviceId"
>;
type ReadRequest = { epoch: number } & (
  { kind: "list"; cursor?: string } | { kind: "detail"; id: string }
);
let nextRegistryBoundary = 0;
export function FarmerRegistry({ client: supplied }: { client?: PilotClient }) {
  const [fallback] = useState(() => new PilotClient());
  const client = supplied ?? fallback;
  const boundary = useMemo(
    () => ({
      id: ++nextRegistryBoundary,
      queries: createProtectedQueryClient(),
    }),
    [client],
  );
  return (
    <QueryClientProvider key={boundary.id} client={boundary.queries}>
      <RegistryView client={client} />
    </QueryClientProvider>
  );
}
function RegistryView({ client }: { client: PilotClient }) {
  const [language, setLanguage] = useState<"en" | "si">("en");
  const copy = words[language];
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
      "farmers",
      request?.kind,
      request?.kind === "list"
        ? { limit: 25, after: request.cursor ?? null }
        : request?.kind === "detail"
          ? { id: request.id }
          : null,
    ],
    enabled: context !== null && request !== null,
    queryFn: async ({ signal }) => {
      if (!context || !request) throw new Error("No active read context");
      const result =
        request.kind === "list"
          ? {
              kind: "list" as const,
              value: await client.farmers(request.cursor, signal),
            }
          : {
              kind: "detail" as const,
              value: await client.farmer(request.id, signal),
            };
      signal.throwIfAborted();
      if (result.value.accountId !== context.accountId)
        throw new PilotRequestError(401);
      return result;
    },
  });
  const busy = authBusy || (request !== null && query.isFetching);
  const data =
    request !== null && !busy && !query.isError ? query.data : undefined;
  const rows = data?.kind === "list" ? data.value.items : [];
  const next = data?.kind === "list" ? data.value.nextCursor : null;
  const selected = data?.kind === "detail" ? data.value.farmer : null;
  const canViewAudit =
    data?.kind === "detail" && data.value.access?.viewAudit === true;
  function clear() {
    sequence.current++;
    authRequest.current?.abort();
    authRequest.current = null;
    void queries.cancelQueries();
    queries.removeQueries();
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
  ) {
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
      setRequest({ kind: "list", cursor, epoch: generation });
    } catch (error) {
      if (active.current && generation === sequence.current) report(error);
    } finally {
      if (active.current && generation === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    active.current = true;
    try {
      const value = localStorage.getItem("agri-language");
      if (value === "en" || value === "si") setLanguage(value);
    } catch {
      /* Optional locale only. */
    }
    void load();
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
    };
  }, [client]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
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
    if (context) setRequest({ kind: "detail", id, epoch: sequence.current });
  }
  useEffect(() => {
    if (request && query.isError) report(query.error);
  }, [query.isError, query.error, request]);
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
            onClick={() => {
              setLanguage(value);
              try {
                localStorage.setItem("agri-language", value);
              } catch {
                /* Optional locale only. */
              }
            }}
          >
            {value === "en" ? "English" : "සිංහල"}
          </button>
        ))}
      </nav>
      <h1>{copy.title}</h1>
      <p>{copy.scope}</p>
      {message && (
        <p role={message === "prepared" ? "status" : "alert"}>
          {copy[message]}
        </p>
      )}
      {busy && <p role="status">{copy.busy}</p>}
      <div className="actions">
        <button disabled={busy} onClick={() => void load()}>
          {copy.refresh}
        </button>
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
      {context && !busy && !selected && (
        <>
          {rows.length === 0 ? (
            <p role="status">{copy.empty}</p>
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
      {selected && (
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
