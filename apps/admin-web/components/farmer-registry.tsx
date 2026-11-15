"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
    review: "Verification and correction actions are not yet available.",
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
    review: "තහවුරු කිරීමේ සහ නිවැරදි කිරීමේ ක්‍රියා තවම ලබාගත නොහැක.",
  },
} as const;
type Context = Awaited<ReturnType<PilotClient["context"]>>;
export function FarmerRegistry({ client: supplied }: { client?: PilotClient }) {
  const [client] = useState(() => supplied ?? new PilotClient());
  const [language, setLanguage] = useState<"en" | "si">("en");
  const copy = words[language];
  const [context, setContext] = useState<Context | null>(null);
  const [rows, setRows] = useState<FarmerSummary[]>([]);
  const [selected, setSelected] = useState<FarmerSummary | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<
    "auth" | "failure" | "missing" | "prepared" | null
  >(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const sequence = useRef(0),
    active = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  function clear() {
    sequence.current++;
    setRows([]);
    setSelected(null);
    setNext(null);
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
      const current = await client.context();
      const page = await client.farmers(cursor);
      if (!active.current || generation !== sequence.current) return;
      if (page.accountId !== current.accountId)
        throw new PilotRequestError(401);
      setContext(current);
      setRows(page.items);
      setNext(page.nextCursor);
      setCursors(history);
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
    try {
      await client.login({
        loginName: String(data.get("loginName") ?? ""),
        password: String(data.get("password") ?? ""),
        otp: String(data.get("otp") ?? ""),
        deviceId: String(data.get("deviceId") ?? ""),
      });
      await load();
    } catch (error) {
      report(error);
    } finally {
      (element.elements.namedItem("password") as HTMLInputElement).value = "";
      (element.elements.namedItem("otp") as HTMLInputElement).value = "";
      setBusy(false);
    }
  }
  async function detail(id: string) {
    const accountId = context?.accountId;
    clear();
    const generation = sequence.current;
    setBusy(true);
    setMessage(null);
    try {
      const result = await client.farmer(id);
      if (!active.current || generation !== sequence.current) return;
      if (result.accountId !== accountId) throw new PilotRequestError(401);
      setSelected(result.farmer);
    } catch (error) {
      if (active.current && generation === sequence.current) report(error);
    } finally {
      if (active.current && generation === sequence.current) setBusy(false);
    }
  }
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
          <button onClick={() => void load()}>{copy.close}</button>
        </section>
      )}
    </main>
  );
}
