"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFieldQueryClient } from "../lib/online-query";
import { PilotClient, PilotRequestError } from "../lib/pilot-client";

const words = {
  en: {
    signIn: "Sign in",
    fingerprint: "Device verification code",
    prepare: "Download device enrollment request",
    prepared:
      "Send this public enrollment request to your administrator through the approved channel. It contains no private key. Approval is required before sign-in.",
    login: "Account name",
    password: "Password",
    otp: "Authenticator code",
    device: "Approved device ID",
    checking: "Checking session…",
    working: "Please wait…",
    logout: "Sign out",
    retry: "Check session again",
    setup:
      "Use your organization-issued account, authenticator and approved device ID. Contact your administrator if these have not been issued.",
    offlineLink: "Open encrypted offline workspace",
    online: "Account and device access",
    limitation:
      "Sign in on your approved device, then open the encrypted workspace. All field registrations are saved there before synchronization.",
    saved: "Synced. Registration saved on the server.",
    auth: "Sign in to continue. Encrypted drafts remain on the device.",
    denied:
      "Action denied. Check that you are using the original account and contact your administrator about your permissions.",
    conflict:
      "Registration conflict. Keep this page open and contact your administrator. The record will not be overwritten.",
    failure:
      "The request could not be completed. Check your connection or contact your administrator.",
    loginFailure:
      "Sign-in failed. Check your account, password, authenticator code and approved device, or try again later.",
    dirty:
      "Save the registration and confirm the result before signing out. Closing or reloading this page can lose unsaved entries.",
  },
  si: {
    signIn: "පුරන්න",
    fingerprint: "උපාංග තහවුරු කිරීමේ කේතය",
    prepare: "උපාංග ලියාපදිංචි ඉල්ලීම බාගන්න",
    prepared:
      "මෙම පොදු ලියාපදිංචි ඉල්ලීම අනුමත මාර්ගයෙන් පරිපාලක වෙත යවන්න. එහි පෞද්ගලික යතුර නොමැත. පුරනය වීමට පෙර අනුමැතිය අවශ්‍යයි.",
    login: "ගිණුම් නාමය",
    password: "මුරපදය",
    otp: "සත්‍යාපක කේතය",
    device: "අනුමත උපාංග හැඳුනුම් අංකය",
    checking: "සැසිය පරීක්ෂා කරමින්…",
    working: "රැඳී සිටින්න…",
    logout: "වරන්න",
    retry: "සැසිය නැවත පරීක්ෂා කරන්න",
    setup:
      "ආයතනයෙන් ලබා දුන් ගිණුම, සත්‍යාපකය සහ අනුමත උපාංග හැඳුනුම් අංකය භාවිත කරන්න. ඒවා නොමැති නම් පරිපාලක අමතන්න.",
    offlineLink: "සංකේතනය කළ නොබැඳි වැඩපොළ විවෘත කරන්න",
    online: "ගිණුම් සහ උපාංග ප්‍රවේශය",
    limitation:
      "අනුමත උපාංගයෙන් පුරනය වී සංකේතනය කළ වැඩපොළ විවෘත කරන්න. සමමුහුර්ත කිරීමට පෙර සියලු ක්ෂේත්‍ර ලියාපදිංචි එහි සුරකී.",
    saved: "සමමුහුර්තයි. ලියාපදිංචිය සේවාදායකයේ සුරැකුණි.",
    auth: "ඉදිරියට යාමට මුල් ගිණුමෙන් නැවත පුරන්න. මෙම පිටුවේ දත්ත රඳවා ඇත.",
    denied: "අවසර නැත. මුල් ගිණුම භාවිත කරන බව පරීක්ෂා කර අවසර පිළිබඳව පරිපාලක අමතන්න.",
    conflict:
      "ලියාපදිංචි ගැටුමකි. මෙම පිටුව විවෘතව තබා පරිපාලක අමතන්න. වාර්තාව උඩින් ලියන්නේ නැත.",
    failure:
      "ඉල්ලීම තහවුරු කළ නොහැකි විය. සම්බන්ධතාව පරීක්ෂා කර නැවත උත්සාහ කරන්න. දත්ත රැක ගැනීමට මෙම පිටුව විවෘතව තබන්න.",
    loginFailure:
      "පුරනය වීම අසාර්ථකයි. ගිණුම, මුරපදය, සත්‍යාපක කේතය සහ අනුමත උපාංගය පරීක්ෂා කරන්න, නැතහොත් පසුව නැවත උත්සාහ කරන්න.",
    dirty:
      "වරන්නට පෙර ලියාපදිංචිය සුරකා ප්‍රතිඵලය තහවුරු කරන්න. පිටුව වැසීමෙන් හෝ නැවත පූරණය කිරීමෙන් නොසුරැකි දත්ත නැති විය හැක.",
  },
} as const;
type Message =
  | "prepared"
  | "saved"
  | "auth"
  | "denied"
  | "conflict"
  | "failure"
  | "loginFailure";

type Props = { language: "en" | "si"; client?: PilotClient };
let nextBoundary = 0;
export function PilotWorkspace({ language, client: supplied }: Props) {
  const [fallback] = useState(() => new PilotClient());
  const client = supplied ?? fallback;
  const boundary = useMemo(
    () => ({ id: ++nextBoundary, queries: createFieldQueryClient() }),
    [client],
  );
  return (
    <QueryClientProvider key={boundary.id} client={boundary.queries}>
      <SessionView client={client} language={language} />
    </QueryClientProvider>
  );
}
function SessionView({
  language,
  client,
}: {
  language: "en" | "si";
  client: PilotClient;
}) {
  const queries = useQueryClient();
  const [revision, setRevision] = useState(0);
  const [readEnabled, setReadEnabled] = useState(true);
  const sequence = useRef(0),
    active = useRef(true);
  const loginForm = useRef<HTMLFormElement>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const c = words[language];
  const query = useQuery({
    queryKey: ["protected", "field-session", { revision }],
    enabled: readEnabled,
    queryFn: async ({ signal }) => {
      const value = await client.context(signal);
      signal.throwIfAborted();
      // The home screen needs identity metadata only; authorized references stay out of this cache.
      return { accountId: value.accountId, deviceId: value.deviceId };
    },
  });
  const context = readEnabled && !query.isError ? query.data : undefined;
  const signedIn = context !== undefined;
  const checking = readEnabled && query.isFetching;
  function clearSession() {
    sequence.current++;
    setReadEnabled(false);
    void queries.cancelQueries();
    queries.removeQueries();
  }
  useEffect(() => {
    active.current = true;
    const hidden = () => {
      if (document.visibilityState === "hidden") clearSession();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active.current = false;
      sequence.current++;
      void queries.cancelQueries();
      queries.clear();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [queries]);
  useEffect(() => {
    if (readEnabled && query.isError) report(query.error);
  }, [readEnabled, query.isError, query.error]);
  function report(error: unknown) {
    const status = error instanceof PilotRequestError ? error.status : 503;
    if (status === 401) {
      setMessage("auth");
    } else
      setMessage(
        status === 403 ? "denied" : status === 409 ? "conflict" : "failure",
      );
  }
  function check() {
    clearSession();
    setRevision((value) => value + 1);
    setReadEnabled(true);
    setMessage(null);
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage(null);
    clearSession();
    const generation = sequence.current;
    try {
      await client.login({
        loginName: String(data.get("loginName") ?? ""),
        password: String(data.get("password") ?? ""),
        otp: String(data.get("otp") ?? ""),
        deviceId: String(data.get("deviceId") ?? ""),
      });
      if (active.current && generation === sequence.current) check();
    } catch (error) {
      if (active.current && generation === sequence.current)
        setMessage(
          error instanceof PilotRequestError && error.status === 403
            ? "denied"
            : "loginFailure",
        );
    } finally {
      // Password and OTP live only in the form/request; clear after every attempt.
      (form.elements.namedItem("password") as HTMLInputElement).value = "";
      (form.elements.namedItem("otp") as HTMLInputElement).value = "";
      setBusy(false);
    }
  }

  return (
    <section className="pilot-workspace" aria-label={c.online}>
      <p className="status">{c.limitation}</p>
      <p>
        <a href="/offline-workspace">{c.offlineLink}</a>
      </p>
      {checking ? (
        <p role="status">{c.checking}</p>
      ) : (
        <>
          {message && (
            <p
              role={
                message === "saved" || message === "prepared"
                  ? "status"
                  : "alert"
              }
            >
              {c[message]}
            </p>
          )}
          {fingerprint && (
            <p>
              {c.fingerprint}:{" "}
              <code style={{ overflowWrap: "anywhere" }}>{fingerprint}</code>
            </p>
          )}
          {!signedIn && (
            <form
              className="registration-form"
              onSubmit={login}
              ref={loginForm}
            >
              <h2>{c.signIn}</h2>
              <p>{c.setup}</p>
              <label htmlFor="pilot-login">{c.login}</label>
              <input
                id="pilot-login"
                name="loginName"
                autoComplete="username"
                maxLength={200}
                required
                disabled={busy}
              />
              <label htmlFor="pilot-password">{c.password}</label>
              <input
                id="pilot-password"
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={1024}
                required
                disabled={busy}
              />
              <label htmlFor="pilot-otp">{c.otp}</label>
              <input
                id="pilot-otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                disabled={busy}
              />
              <label htmlFor="pilot-device">{c.device}</label>
              <input
                id="pilot-device"
                name="deviceId"
                autoComplete="off"
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                required
                disabled={busy}
              />
              <button
                disabled={busy}
                type="button"
                onClick={async () => {
                  const field = loginForm.current?.elements.namedItem(
                    "deviceId",
                  ) as HTMLInputElement | null;
                  if (!field || !field.reportValidity()) return;
                  setBusy(true);
                  try {
                    const request = await client.prepareDevice(field.value);
                    setFingerprint(request.fingerprint);
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(request, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "agri-device-enrollment.json";
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    setMessage("prepared");
                  } catch {
                    setMessage("failure");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {c.prepare}
              </button>
              <button disabled={busy} type="submit">
                {busy ? c.working : c.signIn}
              </button>
            </form>
          )}
          <div className="workspace-actions">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await check();
                } catch (error) {
                  report(error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {c.retry}
            </button>
            {signedIn && (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const known = context;
                  clearSession();
                  try {
                    await client.logout(known);
                    setMessage(null);
                  } catch (error) {
                    report(error);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {c.logout}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
