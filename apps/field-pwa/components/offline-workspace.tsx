"use client";
import { LocaleProvider, useLocale } from "@agri/i18n/react";
import { LocaleToggle } from "@agri/ui/locale-toggle";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  DeviceKeys,
  OfflineWorkspace as Workspace,
  VaultCatalog,
  vaultName,
  type LocalStatus,
  type VaultReference,
} from "@agri/sync-client";
import type {
  FarmerRegistration,
  OfflineReferenceContext,
  WorkingRegistration,
} from "@agri/validation";
import { offlineShellReady } from "../lib/offline-shell";
import { PilotClient, PilotRequestError } from "../lib/pilot-client";
import { FarmerRegistrationForm } from "./farmer-registration-form";
const words = {
  en: {
    shell:
      "Offline app preparation is not complete. Keep saved drafts, close other app tabs and reopen while connected before creating new offline drafts.",
    storage:
      "Persistent storage is not granted. Install the app or contact your administrator. Existing drafts can be recovered, but new offline drafts are disabled.",
    title: "Offline registration workspace",
    online: "Connected",
    offline: "Offline",
    signin: "Online sign-in",
    vault: "Account and device vault",
    choose: "Select a saved device vault",
    unlock: "Set up or unlock",
    pass: "Offline passphrase",
    passHelp:
      "Choose a distinct passphrase of at least 12 characters. Keep it safe; it is needed to recover encrypted drafts. It is never saved by the app.",
    lock: "Lock workspace",
    sync: "Sync Now",
    retrySave: "Retry device save",
    export: "Export encrypted archive",
    remove: "Remove synced local copy",
    recovery:
      "Online verification is required for new registrations. Existing drafts can still be unlocked for recovery.",
    minimal:
      "Only the farmer name, configured location and privacy-notice confirmation are stored. No NIC, phone or documents are cached.",
    saved: "Saved on Device",
    saving: "Saving on device…",
    pending: "Pending Sync",
    syncing: "Syncing…",
    synced: "Synced",
    conflict: "Conflict — review required",
    rejected: "Rejected — review required",
    failure:
      "The action could not be completed. Your saved drafts were retained. Check your connection, storage and original account/device sign-in. Keep this page open if a device save has not completed.",
    auth: "Sign in online with the original account and approved device before syncing. Local data has been retained.",
    empty: "No saved registrations.",
    working: "Incomplete draft saved on device",
    locked: "Workspace locked",
    busy: "Please wait…",
    expires: "Local drafting window ends",
    single:
      "Another tab is using this vault. Close or lock that tab before editing here.",
    archive:
      "The encrypted archive contains saved data and any retained recovery snapshot. Keep it with your offline passphrase; it contains no device private key or session credential.",
    checking: "Checking this device…",
    none: "Sign in online to prepare this approved device for its first offline use.",
    dirty:
      "A device save is pending or failed. Do not close this page before saving or exporting recovery data.",
    prepared:
      "Vault ready. Offline drafting is available within the displayed window; the server checks current permissions again at sync.",
    syncDone: "Sync attempt finished. Check each registration status.",
    restore: "Recovered draft",
    savedLabel: "Device storage",
    importTitle: "Restore an authenticated archive",
    importHelp:
      "Sign in online with the original account on this approved device. The target vault must be empty. Keep the original file: recovery never deletes it. Completed submissions require fresh sync confirmation; conflicts and rejections remain for review.",
    importFile: "Encrypted archive file (version 2)",
    sourcePass: "Original archive passphrase",
    importConfirm:
      "I kept the original archive and want to restore into this empty vault.",
    importAction: "Restore archive",
    importDone:
      "Archive restored. Review recovered drafts and use Sync Now for completed submissions.",
    recoveredList: "Recovered incomplete drafts",
    activate: "Continue this draft",
    legacyHelp:
      "Locked export preserves ciphertext in the legacy format. For supported recovery, unlock the original vault and export a version 2 authenticated archive. Lost-passphrase recovery is unavailable.",
  },
  si: {
    shell:
      "නොබැඳි යෙදුම සැකසීම අවසන් නැත. සුරැකි කෙටුම්පත් රඳවාගෙන අනෙක් ටැබ් වසා, නව කෙටුම්පත් සෑදීමට පෙර සම්බන්ධව සිටියදී නැවත විවෘත කරන්න.",
    storage:
      "ස්ථිර ගබඩා අවසරය නැත. යෙදුම ස්ථාපනය කරන්න හෝ පරිපාලක අමතන්න. සුරැකි කෙටුම්පත් නැවත ලබාගත හැකි නමුත් නව නොබැඳි කෙටුම්පත් සක්‍රීය නැත.",
    title: "නොබැඳි ලියාපදිංචි වැඩපොළ",
    online: "සම්බන්ධයි",
    offline: "නොබැඳියි",
    signin: "මාර්ගගත පුරනය",
    vault: "ගිණුම් සහ උපාංග දත්ත ගබඩාව",
    choose: "සුරැකි උපාංග ගබඩාවක් තෝරන්න",
    unlock: "සකසන්න හෝ අගුල අරින්න",
    pass: "නොබැඳි මුරවැකිය",
    passHelp:
      "අවම අක්ෂර 12ක වෙනම මුරවැකියක් තෝරන්න. සංකේතනය කළ කෙටුම්පත් නැවත ලබා ගැනීමට එය අවශ්‍යයි. යෙදුම එය සුරකින්නේ නැත.",
    lock: "වැඩපොළ අගුළු දමන්න",
    sync: "දැන් සමමුහුර්ත කරන්න",
    retrySave: "උපාංගයේ සුරැකීම නැවත උත්සාහ කරන්න",
    export: "සංකේතනය කළ පිටපත බාගන්න",
    remove: "සමමුහුර්ත දේශීය පිටපත ඉවත් කරන්න",
    recovery:
      "නව ලියාපදිංචි සඳහා මාර්ගගත තහවුරු කිරීම අවශ්‍යයි. සුරැකි කෙටුම්පත් නැවත ලබා ගැනීමට අගුල විවෘත කළ හැක.",
    minimal:
      "ගොවියාගේ නම, සැකසූ ස්ථානය සහ පෞද්ගලිකත්ව දැනුම්දීමේ තහවුරු කිරීම පමණක් සුරකී. හැඳුනුම්පත් අංක, දුරකථන අංක හෝ ලේඛන ගබඩා නොකරයි.",
    saved: "උපාංගයේ සුරැකුණි",
    saving: "උපාංගයේ සුරකිමින්…",
    pending: "සමමුහුර්ත කිරීමට නියමිතයි",
    syncing: "සමමුහුර්ත කරමින්…",
    synced: "සමමුහුර්තයි",
    conflict: "ගැටුමක් — සමාලෝචනය අවශ්‍යයි",
    rejected: "ප්‍රතික්ෂේපයි — සමාලෝචනය අවශ්‍යයි",
    failure:
      "ක්‍රියාව සම්පූර්ණ කළ නොහැකි විය. සුරැකි කෙටුම්පත් රඳවා ඇත. සම්බන්ධතාව, ගබඩාව සහ මුල් ගිණුමේ/උපාංගයේ පුරනය පරීක්ෂා කරන්න. සුරැකීම අවසන් නොමැති නම් මෙම පිටුව විවෘතව තබන්න.",
    auth: "සමමුහුර්ත කිරීමට පෙර මුල් ගිණුමෙන් සහ අනුමත උපාංගයෙන් මාර්ගගතව පුරන්න. දේශීය දත්ත රඳවා ඇත.",
    empty: "සුරැකි ලියාපදිංචි නොමැත.",
    working: "අසම්පූර්ණ කෙටුම්පත උපාංගයේ සුරැකුණි",
    locked: "වැඩපොළ අගුළු දමා ඇත",
    busy: "රැඳී සිටින්න…",
    expires: "දේශීය කෙටුම්පත් කාලය අවසන් වන්නේ",
    single:
      "වෙනත් ටැබයක් මෙම ගබඩාව භාවිත කරයි. මෙහි සංස්කරණයට පෙර එය වසන්න හෝ අගුළු දමන්න.",
    archive:
      "සංකේතනය කළ පිටපතේ සුරැකි දත්ත සහ රඳවා ඇති ප්‍රතිසාධන කෙටුම්පත් ඇත. එය නොබැඳි මුරවැකිය සමඟ සුරක්ෂිතව තබන්න. උපාංගයේ පෞද්ගලික යතුර හෝ සැසි තොරතුරු එහි නැත.",
    checking: "උපාංගය පරීක්ෂා කරමින්…",
    none: "මෙම අනුමත උපාංගයේ පළමු නොබැඳි භාවිතය සැකසීමට මාර්ගගතව පුරන්න.",
    dirty:
      "උපාංගයේ සුරැකීම අවසන් නැත හෝ අසාර්ථකයි. සුරැකීමට හෝ ප්‍රතිසාධන පිටපත බාගැනීමට පෙර පිටුව වසන්න එපා.",
    prepared:
      "ගබඩාව සූදානම්. පෙන්වන කාලය තුළ නොබැඳි කෙටුම්පත් සකස් කළ හැක. සමමුහුර්ත කරන විට සේවාදායකය වත්මන් අවසර නැවත පරීක්ෂා කරයි.",
    syncDone: "සමමුහුර්ත උත්සාහය අවසන්. එක් එක් ලියාපදිංචියේ තත්ත්වය බලන්න.",
    restore: "නැවත ලබාගත් කෙටුම්පත",
    savedLabel: "උපාංග ගබඩාව",
    importTitle: "සත්‍යාපිත සංකේතනය කළ පිටපත නැවත ලබාගන්න",
    importHelp:
      "මෙම අනුමත උපාංගයෙන් මුල් ගිණුමට මාර්ගගතව පුරන්න. ඉලක්ක ගබඩාව හිස් විය යුතුය. මුල් ගොනුව තබාගන්න: එය මකා නොදමයි. සම්පූර්ණ ලියාපදිංචි නැවත සමමුහුර්ත කර තහවුරු කළ යුතුය. ගැටුම් සහ ප්‍රතික්ෂේප සමාලෝචනය සඳහා රඳවා ඇත.",
    importFile: "සංකේතනය කළ ගොනුව (අනුවාදය 2)",
    sourcePass: "මුල් පිටපතේ මුරවැකිය",
    importConfirm: "මුල් ගොනුව තබාගෙන මෙම හිස් ගබඩාවට දත්ත නැවත ලබාගැනීමට එකඟ වෙමි.",
    importAction: "පිටපත නැවත ලබාගන්න",
    importDone: "පිටපත නැවත ලබාගත්තා. කෙටුම්පත් පරීක්ෂා කර සම්පූර්ණ ලියාපදිංචි සමමුහුර්ත කරන්න.",
    recoveredList: "නැවත ලබාගත් අසම්පූර්ණ කෙටුම්පත්",
    activate: "මෙම කෙටුම්පත දිගටම සකසන්න",
    legacyHelp:
      "අගුළු දැමූ පිටපත පැරණි ආකෘතියෙන් දත්ත රඳවා ගනී. නැවත ලබාගැනීමට මුල් ගබඩාව විවෘත කර අනුවාදය 2 පිටපතක් බාගන්න. අමතක වූ මුරවැකියක් නැවත ලබාගත නොහැක.",
  },
} as const;
type Entry = { id: string; status: LocalStatus; farmer: FarmerRegistration };
export function OfflineWorkspacePage() {
  return (
    <LocaleProvider initial="si">
      <OfflineWorkspaceView />
    </LocaleProvider>
  );
}
function OfflineWorkspaceView() {
  const [language, setLanguage] = useLocale();
  const c = words[language];
  const [client] = useState(() => new PilotClient());
  const [keys] = useState(() => new DeviceKeys());
  const [catalog] = useState(() => new VaultCatalog());
  const [vaults, setVaults] = useState<VaultReference[]>([]);
  const [selected, setSelected] = useState("");
  const [fresh, setFresh] = useState<OfflineReferenceContext | null>(null);
  const model = useRef<Workspace | null>(null);
  const release = useRef<(() => void) | null>(null);
  const editorLock = useRef(false);
  const generation = useRef(0);
  const durableStorage = useRef(false);
  const shellReady = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [unlocked, setUnlocked] = useState(false);
  const [online, setOnline] = useState(true);
  const [context, setContext] = useState<OfflineReferenceContext | null>(null);
  const [working, setWorking] = useState<WorkingRegistration | undefined>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const reloadSequence = useRef(0);
  const [recovered, setRecovered] = useState<
    Array<{ slot: string; value: WorkingRegistration }>
  >([]);
  const [dirty, setDirty] = useState(false);
  const writes = useRef(0);
  const [saveState, setSaveState] = useState<
    "saving" | "saved" | "error" | null
  >(null);
  const [message, setMessage] = useState<
    | "failure"
    | "auth"
    | "single"
    | "prepared"
    | "syncDone"
    | "importDone"
    | null
  >(null);
  const [editable, setEditable] = useState(false);
  const clear = useCallback(() => {
    generation.current++;
    reloadSequence.current++;
    editorLock.current = false;
    setUnlocked(false);
    setContext(null);
    setWorking(undefined);
    setEntries([]);
    setSyncingId(null);
    setRecovered([]);
    setEditable(false);
    release.current?.();
    release.current = null;
  }, []);
  useEffect(() => {
    let active = true;
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    Promise.allSettled([catalog.list(), client.context()]).then((results) => {
      if (!active) return;
      const local = results[0].status === "fulfilled" ? results[0].value : [];
      const current =
        results[1].status === "fulfilled" ? results[1].value : null;
      if (current) {
        const id = vaultName(current.accountId, current.deviceId);
        setFresh(current);
        setSelected(id);
        setVaults([
          {
            id,
            accountId: current.accountId,
            deviceId: current.deviceId,
            lastVerifiedAt: current.verifiedAt,
          },
          ...local.filter((row) => row.id !== id),
        ]);
      } else {
        setVaults(local);
        setSelected(local[0]?.id ?? "");
      }
      setLoading(false);
    });
    return () => {
      active = false;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      model.current?.onLock(() => {});
      model.current?.close();
      release.current?.();
      catalog.close();
      keys.close();
    };
  }, [client, catalog, keys]);
  useEffect(() => {
    if (!dirty && saveState !== "saving" && saveState !== "error") return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saveState]);
  async function lock() {
    try {
      await model.current?.lock();
    } catch {
      setMessage("failure");
    } finally {
      clear();
    }
  }
  useEffect(() => {
    if (!unlocked) return;
    let timer: ReturnType<typeof setTimeout>;
    const activity = () => {
      clearTimeout(timer);
      if (model.current?.isUnlocked) model.current.outbox.touch();
      timer = setTimeout(() => void lock(), 300000);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") void lock();
    };
    activity();
    const tick = setInterval(() => {
      setEditable(
        (model.current?.canCreate() ?? false) &&
          editorLock.current &&
          durableStorage.current &&
          shellReady.current,
      );
      if (!model.current?.isUnlocked) clear();
      else if (!model.current.canAccess()) {
        setMessage("auth");
        void lock();
      }
    }, 1000);
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", hidden);
    };
    // Lock is driven by the current model reference; no state captured from a registration payload.
  }, [unlocked, clear]);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("agri-offline-access");
    channel.onmessage = (event) => {
      const current = model.current;
      if (
        current &&
        event.data?.state === "suspended" &&
        event.data.accountId === current.accountId &&
        event.data.deviceId === current.deviceId
      ) {
        setMessage("auth");
        void lock();
      }
    };
    return () => channel.close();
  }, [clear]);
  const reload = async () => {
    const load = ++reloadSequence.current;
    const current = model.current;
    const version = generation.current;
    if (!current?.isUnlocked) {
      clear();
      return;
    }
    const [rows, recoveredRows] = await Promise.all([
      current.entries(),
      current.outbox.recoveredWorking(),
    ]);
    if (
      version !== generation.current ||
      load !== reloadSequence.current ||
      model.current !== current ||
      !current.isUnlocked
    )
      return;
    setContext(current.context);
    setEntries(rows);
    setRecovered(recoveredRows);
    setEditable(
      current.canCreate() &&
        editorLock.current &&
        durableStorage.current &&
        shellReady.current,
    );
  };
  async function claim(): Promise<boolean> {
    if (!navigator.locks) {
      editorLock.current = false;
      return true;
    }
    return new Promise((resolve) => {
      void navigator.locks
        .request(
          `agri-vault:${selected}`,
          { mode: "exclusive", ifAvailable: true },
          async (handle) => {
            if (!handle) {
              resolve(false);
              return;
            }
            await new Promise<void>((done) => {
              editorLock.current = true;
              release.current = done;
              resolve(true);
            });
          },
        )
        .catch(() => resolve(false));
    });
  }
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const field = form.elements.namedItem("passphrase") as HTMLInputElement;
    const chosen = vaults.find((row) => row.id === selected);
    if (!chosen) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!(await claim())) {
        setMessage("single");
        return;
      }
      if (
        !model.current ||
        model.current.accountId !== chosen.accountId ||
        model.current.deviceId !== chosen.deviceId
      ) {
        model.current?.close();
        model.current = new Workspace(
          chosen.accountId,
          chosen.deviceId,
          keys,
          catalog,
        );
      }
      const current = model.current;
      current.onLock(clear);
      shellReady.current = await offlineShellReady();
      durableStorage.current =
        (await navigator.storage?.persisted?.().catch(() => false)) ||
        (await navigator.storage?.persist?.().catch(() => false)) ||
        false;
      let verified =
        fresh?.accountId === chosen.accountId &&
        fresh.deviceId === chosen.deviceId
          ? fresh
          : undefined;
      try {
        const latest = await client.context();
        if (
          latest.accountId === chosen.accountId &&
          latest.deviceId === chosen.deviceId
        ) {
          verified = latest;
          setFresh(latest);
        } else {
          verified = undefined;
          await catalog.suspend(chosen.accountId, chosen.deviceId);
        }
      } catch (error) {
        if ([401, 403].includes((error as { status?: number })?.status ?? 0)) {
          verified = undefined;
          await catalog.suspend(chosen.accountId, chosen.deviceId);
        }
      }
      await current.unlock(field.value, verified);
      if (!current.canAccess()) {
        await current.lock();
        setMessage("auth");
        return;
      }
      setUnlocked(true);
      setWorking((await current.outbox.readWorking())?.value);
      setSaveState(current.outbox.hasUnsavedRecovery ? "error" : "saved");
      setDirty(current.outbox.hasUnsavedRecovery);
      await reload();
      setMessage(current.outbox.hasUnsavedRecovery ? "failure" : "prepared");
    } catch {
      setMessage("failure");
      release.current?.();
      release.current = null;
      if (model.current?.isUnlocked) await model.current.lock().catch(() => {});
    } finally {
      field.value = "";
      setBusy(false);
    }
  }
  const capture = (value: WorkingRegistration) => {
    const current = model.current;
    if (!current?.isUnlocked) return;
    writes.current++;
    setSaveState("saving");
    setDirty(true);
    void current
      .capture(value)
      .then(() => {
        if (--writes.current === 0) {
          setSaveState("saved");
          setDirty(false);
        }
      })
      .catch(() => {
        writes.current--;
        setSaveState("error");
        setDirty(true);
        setMessage("failure");
      });
  };
  async function save(value: FarmerRegistration) {
    const current = model.current;
    if (!current) throw new Error("Locked");
    await current.complete(value);
    setSaveState("saved");
    setDirty(false);
    setWorking(undefined);
    await reload();
    if (navigator.onLine) void sync();
  }
  async function sync() {
    if (busyRef.current || !model.current?.isUnlocked) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const current = model.current;
    const version = generation.current;
    const valid = () =>
      model.current === current &&
      generation.current === version &&
      current.isUnlocked;
    try {
      await current.sync(client, (id) => {
        if (!valid()) return;
        setSyncingId(id);
        if (id)
          void reload().catch(() => {
            if (valid()) clear();
          });
      });
      if (!valid()) return;
      await reload();
      setMessage("syncDone");
    } catch (error) {
      if (!valid()) return;
      setMessage(
        (error instanceof PilotRequestError &&
          [401, 403].includes(error.status)) ||
          (error as { status?: number })?.status === 401
          ? "auth"
          : "failure",
      );
      if (!model.current?.canAccess()) await lock();
      else if (model.current?.isUnlocked) await reload().catch(() => clear());
    } finally {
      if (model.current === current && generation.current === version)
        setSyncingId(null);
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!online || !unlocked) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (canceled) return;
      if (busyRef.current) {
        timer = setTimeout(attempt, 100);
        return;
      }
      void sync();
    };
    timer = setTimeout(attempt, 0);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [online, unlocked]);
  async function restoreArchive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      busyRef.current ||
      !model.current?.isUnlocked ||
      !editorLock.current ||
      !durableStorage.current ||
      !shellReady.current
    )
      return;
    const form = event.currentTarget;
    const password = form.elements.namedItem(
      "sourcePassphrase",
    ) as HTMLInputElement;
    const fileInput = form.elements.namedItem(
      "archiveFile",
    ) as HTMLInputElement;
    const confirmation = form.elements.namedItem(
      "confirmImport",
    ) as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file || !confirmation.checked) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (file.size > 10000000) throw new Error("Archive size limit exceeded");
      await model.current.importArchive(
        await file.text(),
        password.value,
        client,
      );
      await reload();
      setMessage("importDone");
    } catch {
      setMessage("failure");
      if (!model.current?.canAccess()) await lock();
    } finally {
      password.value = "";
      fileInput.value = "";
      confirmation.checked = false;
      setBusy(false);
    }
  }
  const statuses: Record<LocalStatus, string> = {
    "saved-on-device": c.saved,
    "pending-sync": c.pending,
    synced: c.synced,
    conflict: c.conflict,
    rejected: c.rejected,
  };
  return (
    <main className="field-frame">
      <div className="field-frame__bar">
        <LocaleToggle
          value={language}
          onChange={setLanguage}
          label="Language / භාෂාව"
        />
      </div>
      <div className="workspace-actions">
        <a className="nav-link" href="/">
          {c.signin}
        </a>
      </div>
      <div className="card">
        <h1>{c.title}</h1>
        <p role="status">{online ? c.online : c.offline}</p>
        <p>{c.minimal}</p>
        {message && (
          <p
            role={
              message === "prepared" ||
              message === "syncDone" ||
              message === "importDone"
                ? "status"
                : "alert"
            }
          >
            {c[message]}
          </p>
        )}
        {loading ? (
          <p>{c.checking}</p>
        ) : (
          <>
            <label htmlFor="offline-vault">{c.vault}</label>
            <select
              id="offline-vault"
              value={selected}
              disabled={
                unlocked ||
                busy ||
                Boolean(model.current?.outbox.hasUnsavedRecovery)
              }
              onChange={(event) => {
                setSelected(event.target.value);
                setMessage(null);
              }}
            >
              <option value="">{c.choose}</option>
              {vaults.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.accountId.slice(-8)} / {row.deviceId.slice(-8)}
                </option>
              ))}
            </select>
            {!unlocked ? (
              <>
                <p role="status">{c.locked}</p>
                {selected && (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      try {
                        const chosen = vaults.find(
                          (row) => row.id === selected,
                        );
                        if (!chosen) return;
                        const box =
                          model.current?.accountId === chosen.accountId &&
                          model.current.deviceId === chosen.deviceId
                            ? model.current.outbox
                            : new Workspace(
                                chosen.accountId,
                                chosen.deviceId,
                                keys,
                                catalog,
                              ).outbox;
                        const archive = await box.exportEncryptedArchive();
                        const url = URL.createObjectURL(
                          new Blob([archive], { type: "application/json" }),
                        );
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = "agri-encrypted-recovery.json";
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        if (box !== model.current?.outbox) box.close();
                      } catch {
                        setMessage("failure");
                      }
                    }}
                  >
                    {c.export}
                  </button>
                )}
                {selected && <p>{c.legacyHelp}</p>}
                {vaults.length === 0 ? (
                  <p>{c.none}</p>
                ) : (
                  <form className="registration-form" onSubmit={unlock}>
                    <label htmlFor="offline-passphrase">{c.pass}</label>
                    <input
                      id="offline-passphrase"
                      name="passphrase"
                      type="password"
                      autoComplete="off"
                      minLength={12}
                      maxLength={256}
                      required
                      disabled={busy}
                    />
                    <p>{c.passHelp}</p>
                    <button type="submit" disabled={busy || !selected}>
                      {busy ? c.busy : c.unlock}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <>
                <div className="workspace-actions">
                  {saveState === "error" && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await model.current!.retryLocalSave();
                          setSaveState("saved");
                          setDirty(false);
                          await reload();
                        } catch {
                          setMessage("failure");
                        }
                      }}
                    >
                      {c.retrySave}
                    </button>
                  )}
                  <button onClick={() => void lock()} disabled={busy}>
                    {c.lock}
                  </button>
                  <button onClick={() => void sync()} disabled={busy}>
                    {busy ? c.busy : c.sync}
                  </button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await model.current!.flush().catch(() => {});
                        const archive =
                          await model.current!.outbox.exportAuthenticatedArchive();
                        const url = URL.createObjectURL(
                          new Blob([archive], { type: "application/json" }),
                        );
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = "agri-encrypted-recovery.json";
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      } catch {
                        setMessage("failure");
                      }
                    }}
                  >
                    {c.export}
                  </button>
                </div>
                <p>{c.archive}</p>
                {context && (
                  <p>
                    {c.expires}:{" "}
                    {new Date(context.offlineUntil).toLocaleString(
                      language === "si" ? "si-LK" : "en-GB",
                    )}
                  </p>
                )}
                {!editable && (
                  <p role="status">
                    {!durableStorage.current
                      ? c.storage
                      : !shellReady.current
                        ? c.shell
                        : c.recovery}
                  </p>
                )}
                {(dirty || saveState === "error") && (
                  <p role="alert">{c.dirty}</p>
                )}
                <p role="status" aria-label={c.savedLabel}>
                  {saveState === "saving"
                    ? c.saving
                    : saveState === "error"
                      ? c.failure
                      : c.saved}
                </p>
                <FarmerRegistrationForm
                  key={working?.farmerId ?? "new"}
                  language={language}
                  geographies={context?.geographies ?? []}
                  initialDraft={working}
                  onDraftChange={capture}
                  onSave={save}
                  enabled={editable && !busy}
                  freezeAfterAttempt
                />
                {working && <p>{c.restore}</p>}
                {recovered.length > 0 && (
                  <section aria-label={c.recoveredList}>
                    <h2>{c.recoveredList}</h2>
                    <ul>
                      {recovered.map((row) => (
                        <li key={row.slot}>
                          <p>{row.value.fullName || c.working}</p>
                          <button
                            disabled={busy || !editable}
                            onClick={async () => {
                              try {
                                const draft =
                                  await model.current!.activateRecovered(
                                    row.slot,
                                  );
                                setWorking(draft);
                                setSaveState("saved");
                                setDirty(false);
                                await reload();
                              } catch {
                                setMessage("failure");
                              }
                            }}
                          >
                            {c.activate}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <details>
                  <summary>{c.importTitle}</summary>
                  <p>{c.importHelp}</p>
                  <form className="registration-form" onSubmit={restoreArchive}>
                    <label htmlFor="archive-file">{c.importFile}</label>
                    <input
                      id="archive-file"
                      name="archiveFile"
                      type="file"
                      accept="application/json,.json"
                      required
                      disabled={busy}
                    />
                    <label htmlFor="archive-passphrase">{c.sourcePass}</label>
                    <input
                      id="archive-passphrase"
                      name="sourcePassphrase"
                      type="password"
                      autoComplete="off"
                      minLength={12}
                      maxLength={256}
                      required
                      disabled={busy}
                    />
                    <label>
                      <input
                        name="confirmImport"
                        type="checkbox"
                        required
                        disabled={busy}
                      />{" "}
                      {c.importConfirm}
                    </label>
                    <button
                      type="submit"
                      disabled={busy || !online || !editable}
                    >
                      {c.importAction}
                    </button>
                  </form>
                </details>
                <h2>{c.saved}</h2>
                {entries.length === 0 ? (
                  <p>{c.empty}</p>
                ) : (
                  <ul>
                    {entries.map((row) => (
                      <li key={row.id}>
                        <p>{row.farmer.fullName}</p>
                        <p role="status">
                          {syncingId === row.id
                            ? c.syncing
                            : statuses[row.status]}
                        </p>
                        {row.status === "synced" && (
                          <button
                            disabled={busy}
                            onClick={async () => {
                              try {
                                await model.current!.outbox.removeSynced(
                                  row.id,
                                );
                                await reload();
                              } catch {
                                setMessage("failure");
                              }
                            }}
                          >
                            {c.remove}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
